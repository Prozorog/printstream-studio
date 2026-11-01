#!/usr/bin/env node
/**
 * Finalize the parent-exported Blender asset without flattening its mechanics.
 *
 * node scripts/finalize_glb.mjs
 * Optional: --input, --output, --materials, --ao, --stats (project-relative).
 *
 * Dependencies: @gltf-transform/{core,extensions,functions}, draco3dgltf, sharp.
 * No join, flatten, prune, resample, animation baking, or node renaming occurs.
 * The material contract supplies exact names, linear factors, absolute roughness,
 * clearcoat, thin-film thickness and the independently packed second UV AO atlas.
 * All texture conversion is lossless WebP and performed serially to bound memory.
 * Keep the direct Sharp dependency aligned with glTF Transform's pixel backend:
 * mixed native versions in Windows can bind incompatible libvips DLL symbols.
 */
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { NodeIO } from '@gltf-transform/core';
import {
  ALL_EXTENSIONS,
  EXTTextureWebP,
  KHRMaterialsClearcoat,
  KHRMaterialsIridescence,
} from '@gltf-transform/extensions';
import { compressTexture, draco } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({
  options: {
    input: { type: 'string' },
    output: { type: 'string' },
    materials: { type: 'string', default: 'assets/materials.json' },
    ao: { type: 'string' },
    stats: { type: 'string' },
  },
  strict: true,
  allowPositionals: false,
});
const absolute = (filename) => path.resolve(ROOT, filename);
const relative = (filename) => path.relative(ROOT, filename).split(path.sep).join('/');
const requireCondition = (condition, message) => {
  if (!condition) throw new Error(message);
};
// Maps are authored as sRGB bytes or untagged linear-data bytes. Explicit sRGB
// storage preserves RGB samples; grayscale scalar maps are read as b-w below.
const textureEncoder = (input, options) => sharp(input, options)
  .pipelineColourspace('srgb').toColourspace('srgb');
const near = (a, b) => Math.abs(a - b) <= 1e-7;
const coatExtensionName = 'KHR_materials_clearcoat';
const filmExtensionName = 'KHR_materials_iridescence';

function glbJSON(bytes) {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  requireCondition(buffer.length >= 20 && buffer.readUInt32LE(0) === 0x46546c67, 'Input is not a GLB.');
  requireCondition(buffer.readUInt32LE(4) === 2, 'Only glTF 2.0 GLB files are supported.');
  requireCondition(buffer.readUInt32LE(8) === buffer.length, 'GLB byte length does not match its header.');
  const jsonLength = buffer.readUInt32LE(12);
  requireCondition(buffer.readUInt32LE(16) === 0x4e4f534a && 20 + jsonLength <= buffer.length, 'GLB JSON chunk is invalid.');
  return JSON.parse(buffer.toString('utf8', 20, 20 + jsonLength).trim());
}

function materialNodes(document, rifle) {
  const inside = new Set();
  rifle.traverse((node) => inside.add(node));
  const users = new Map();
  for (const node of document.getRoot().listNodes()) {
    for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
      const material = primitive.getMaterial();
      requireCondition(material || !inside.has(node), `Model primitive on ${node.getName()} has no material.`);
      if (!material) continue;
      if (!users.has(material)) users.set(material, { inside: [], outside: [] });
      users.get(material)[inside.has(node) ? 'inside' : 'outside'].push({ node, primitive });
    }
  }
  return { inside, users };
}

function sampling(info, texCoord = 0, clamp = false) {
  if (!info) return;
  info.setTexCoord(texCoord)
    .setWrapS(clamp ? 33071 : 10497)
    .setWrapT(clamp ? 33071 : 10497)
    .setMagFilter(9729)
    .setMinFilter(9987);
}

function matrixOf(node) {
  if (node.matrix) return node.matrix;
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const xx = 2 * x * x, xy = 2 * x * y, xz = 2 * x * z;
  const yy = 2 * y * y, yz = 2 * y * z, zz = 2 * z * z;
  const wx = 2 * w * x, wy = 2 * w * y, wz = 2 * w * z;
  return [
    (1 - yy - zz) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - xx - zz) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - xx - yy) * sz, 0,
    tx, ty, tz, 1,
  ];
}

function graphSnapshot(json) {
  const nodes = json.nodes ?? [];
  const parents = new Map();
  nodes.forEach((node, index) => (node.children ?? []).forEach((child) => parents.set(child, index)));
  const graph = new Map();
  const visit = (index, key) => {
    const node = nodes[index];
    const record = {
      name: node.name ?? '',
      matrix: matrixOf(node),
      children: (node.children ?? []).map((child) => nodes[child].name ?? ''),
      hasMesh: node.mesh !== undefined,
      hasSkin: node.skin !== undefined,
      extras: node.extras ?? {},
    };
    graph.set(key, record);
    (node.children ?? []).forEach((child, ordinal) => visit(child, `${key}/${ordinal}:${nodes[child].name ?? ''}`));
  };
  let rootOrdinal = 0;
  nodes.forEach((node, index) => {
    if (!parents.has(index)) visit(index, `${rootOrdinal++}:${node.name ?? ''}`);
  });
  return graph;
}

function animationSnapshot(json) {
  return (json.animations ?? []).map((animation) => ({
    name: animation.name ?? '',
    channels: animation.channels.map((channel) => {
      const sampler = animation.samplers[channel.sampler];
      return {
        target: json.nodes[channel.target.node]?.name ?? '',
        path: channel.target.path,
        interpolation: sampler.interpolation ?? 'LINEAR',
        inputCount: json.accessors[sampler.input].count,
        outputCount: json.accessors[sampler.output].count,
      };
    }),
  }));
}

function checkPreservation(source, output, requiredNames) {
  const before = graphSnapshot(source);
  const after = graphSnapshot(output);
  requireCondition(before.size === after.size, 'Finalization changed the number of nodes.');
  for (const [key, original] of before) {
    const current = after.get(key);
    requireCondition(current, `Semantic hierarchy changed at ${key}.`);
    requireCondition(original.matrix.every((v, i) => near(v, current.matrix[i])), `Local pivot/transform changed at ${key}.`);
    for (const field of ['name', 'children', 'hasMesh', 'hasSkin', 'extras']) {
      requireCondition(JSON.stringify(original[field]) === JSON.stringify(current[field]), `Node ${field} changed at ${key}.`);
    }
  }
  for (const name of requiredNames) {
    requireCondition(output.nodes.filter((node) => node.name === name).length === 1, `Required semantic node must occur exactly once: ${name}`);
  }
  requireCondition(JSON.stringify(animationSnapshot(source)) === JSON.stringify(animationSnapshot(output)), 'Animation names, targets, interpolation or sample counts changed.');
}

function countGeometry(document, modelNodes) {
  const root = document.getRoot();
  const materialNames = new Set();
  const parts = [];
  let triangles = 0;
  let drawCalls = 0;
  let vertices = 0;
  const triangleCount = (primitive) => {
    const count = (primitive.getIndices() ?? primitive.getAttribute('POSITION'))?.getCount() ?? 0;
    const mode = primitive.getMode();
    if (mode === 4) return Math.floor(count / 3);
    if (mode === 5 || mode === 6) return Math.max(0, count - 2);
    return 0;
  };
  for (const node of modelNodes) {
    const primitives = node.getMesh()?.listPrimitives() ?? [];
    if (!primitives.length) continue;
    const partTriangles = primitives.reduce((sum, primitive) => sum + triangleCount(primitive), 0);
    triangles += partTriangles;
    drawCalls += primitives.length;
    for (const primitive of primitives) materialNames.add(primitive.getMaterial().getName());
    parts.push({ name: node.getName(), triangles: partTriangles, drawCalls: primitives.length,
      materials: [...new Set(primitives.map((primitive) => primitive.getMaterial().getName()))] });
  }
  const uniquePositions = new Set();
  for (const mesh of root.listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const positions = primitive.getAttribute('POSITION');
      if (positions && !uniquePositions.has(positions)) {
        uniquePositions.add(positions);
        vertices += positions.getCount();
      }
    }
  }
  return { triangles, drawCalls, vertices, materialCount: materialNames.size, meshCount: root.listMeshes().length,
    primitiveCount: root.listMeshes().reduce((sum, mesh) => sum + mesh.listPrimitives().length, 0), parts };
}

function validateFinalMaterials(json, configuration, modelMaterialNames) {
  const reports = [];
  const aoTextureIndices = new Set();
  for (const material of json.materials ?? []) {
    if (!modelMaterialNames.has(material.name)) continue;
    const spec = configuration.materials[material.name];
    const pbr = material.pbrMetallicRoughness ?? {};
    requireCondition(near(pbr.metallicFactor ?? 1, spec.metalness), `Incorrect metallic factor on ${material.name}.`);
    requireCondition(near(pbr.roughnessFactor ?? 1, spec.roughnessTexture ? 1 : spec.roughness), `Incorrect roughness factor on ${material.name}.`);
    requireCondition((pbr.baseColorFactor ?? [1, 1, 1, 1]).every((value, index) => near(value, spec.baseColorFactor[index])), `Incorrect linear pigment factor on ${material.name}.`);
    if (spec.baseColorTexture) requireCondition(pbr.baseColorTexture, `Missing authored color atlas on ${material.name}.`);
    if (spec.roughnessTexture) requireCondition(pbr.metallicRoughnessTexture, `Missing packed absolute roughness on ${material.name}.`);
    if (spec.normalTexture) requireCondition(material.normalTexture && near(material.normalTexture.scale ?? 1, spec.normalScale), `Missing/incorrect normal texture on ${material.name}.`);
    const film = material.extensions?.[filmExtensionName];
    const coat = material.extensions?.[coatExtensionName];
    if (spec.iridescence.factor > 0) {
      requireCondition(film && near(film.iridescenceFactor ?? 0, spec.iridescence.factor), `Missing/incorrect thin-film factor on ${material.name}.`);
      requireCondition(near(film.iridescenceIor ?? 1.3, spec.iridescence.ior), `Incorrect thin-film IOR on ${material.name}.`);
      requireCondition(near(film.iridescenceThicknessMinimum ?? 100, spec.iridescence.thicknessMinimum)
        && near(film.iridescenceThicknessMaximum ?? 400, spec.iridescence.thicknessMaximum), `Incorrect thin-film range on ${material.name}.`);
      if (spec.iridescence.thicknessTexture) {
        requireCondition(film.iridescenceThicknessTexture && (film.iridescenceThicknessTexture.texCoord ?? 0) === 0,
          `Missing UV0 film-thickness gradient on ${material.name}.`);
      }
    } else {
      requireCondition(!film || (film.iridescenceFactor ?? 0) === 0, `Unexpected film layer on ${material.name}.`);
    }
    if (spec.clearcoat.factor > 0) {
      requireCondition(coat && near(coat.clearcoatFactor ?? 0, spec.clearcoat.factor)
        && near(coat.clearcoatRoughnessFactor ?? 0, spec.clearcoat.roughness), `Missing/incorrect clearcoat on ${material.name}.`);
    } else {
      requireCondition(!coat || (coat.clearcoatFactor ?? 0) === 0, `Unexpected clearcoat on ${material.name}.`);
    }
    if (spec.ao) {
      requireCondition(material.occlusionTexture?.texCoord === configuration.ao.texCoord,
        `AO must use TEXCOORD_1 on ${material.name}.`);
      requireCondition(near(material.occlusionTexture.strength ?? 1, configuration.ao.strength), `Incorrect AO strength on ${material.name}.`);
      aoTextureIndices.add(material.occlusionTexture.index);
    }
    reports.push({ name: material.name, metallicFactor: pbr.metallicFactor ?? 1,
      roughnessFactor: pbr.roughnessFactor ?? 1, authoredRoughness: spec.roughness,
      baseColorTexture: spec.baseColorTexture ?? null, film: film ?? null, clearcoat: coat ?? null,
      normalScale: material.normalTexture?.scale ?? null, aoTexCoord: material.occlusionTexture?.texCoord ?? null });
  }
  for (const material of json.materials ?? []) {
    if (!modelMaterialNames.has(material.name) && material.occlusionTexture) {
      requireCondition(!aoTextureIndices.has(material.occlusionTexture.index), `Model AO atlas leaked onto non-model material ${material.name}.`);
    }
  }
  for (const extension of [filmExtensionName, coatExtensionName, 'KHR_draco_mesh_compression', 'EXT_texture_webp']) {
    requireCondition(json.extensionsUsed?.includes(extension), `Expected extension absent from final GLB: ${extension}`);
  }
  for (const extension of ['KHR_draco_mesh_compression', 'EXT_texture_webp']) {
    requireCondition(json.extensionsRequired?.includes(extension), `Compressed data extension must be required: ${extension}`);
  }
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives) {
      const material = json.materials?.[primitive.material];
      if (modelMaterialNames.has(material?.name) && configuration.materials[material.name].ao) {
        requireCondition(primitive.attributes.TEXCOORD_1 !== undefined, `Missing exported second UV channel on ${mesh.name ?? material.name}.`);
      }
    }
  }
  return reports;
}

async function findAO(configuration) {
  const candidates = values.ao ? [values.ao] : [configuration.ao.texture, configuration.ao.alternateTexture].filter(Boolean);
  for (const filename of candidates) {
    const candidate = absolute(filename);
    try {
      await access(candidate);
      return candidate;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  throw new Error(`Baked AO is required. Parent must finish the isolated-part UV1 atlas first. Tried: ${candidates.join(', ')}`);
}

async function main() {
  const configuration = JSON.parse(await readFile(absolute(values.materials), 'utf8'));
  requireCondition(configuration.schemaVersion === 1, 'Unsupported material contract version.');
  requireCondition(configuration.ao.texCoord === 1, 'The asset contract requires AO on the second UV set.');
  const input = absolute(values.input ?? configuration.export.input);
  const output = absolute(values.output ?? configuration.export.output);
  const statsFile = absolute(values.stats ?? configuration.export.stats);
  requireCondition(input !== output, 'Raw and finalized GLB paths must differ.');
  const aoPath = await findAO(configuration);
  const rawBytes = await readFile(input);
  const sourceJSON = glbJSON(rawBytes);
  const [decoder, encoder] = await Promise.all([draco3d.createDecoderModule(), draco3d.createEncoderModule()]);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'draco3d.decoder': decoder,
    'draco3d.encoder': encoder,
  });
  const document = await io.readBinary(new Uint8Array(rawBytes));
  const root = document.getRoot();
  const rifles = root.listNodes().filter((node) => node.getName() === configuration.export.modelRoot);
  requireCondition(rifles.length === 1, `Expected exactly one ${configuration.export.modelRoot} root.`);
  const { inside, users } = materialNodes(document, rifles[0]);
  const modelMaterials = [...users].filter(([, usage]) => usage.inside.length).map(([material]) => material);
  const modelNames = new Set(modelMaterials.map((material) => material.getName()));
  for (const name of configuration.requiredNodes) {
    requireCondition([...inside].filter((node) => node.getName() === name).length === 1, `Missing/ambiguous required model part: ${name}`);
  }
  for (const name of configuration.requiredMaterials) requireCondition(modelNames.has(name), `Required material missing from Rifle: ${name}`);
  for (const material of modelMaterials) {
    const name = material.getName();
    requireCondition(Object.hasOwn(configuration.materials, name), `Model material ${name} is not in assets/materials.json; use the exact authoritative name.`);
    requireCondition(users.get(material).outside.length === 0, `Material ${name} is shared with non-Rifle geometry. Give the stage its own material before export.`);
    const spec = configuration.materials[name];
    for (const { node, primitive } of users.get(material).inside) {
      const positions = primitive.getAttribute('POSITION');
      const uv0 = primitive.getAttribute('TEXCOORD_0');
      const uv1 = primitive.getAttribute('TEXCOORD_1');
      const needsUV0 = spec.baseColorTexture || spec.normalTexture || spec.roughnessTexture || spec.iridescence.thicknessTexture;
      requireCondition(!needsUV0 || (uv0 && positions && uv0.getCount() === positions.getCount()), `Missing/incomplete UV0 on ${node.getName()}.`);
      requireCondition(!spec.ao || (uv1 && positions && uv1.getCount() === positions.getCount()), `Missing/incomplete UV1 AO atlas on ${node.getName()}.`);
    }
  }

  sharp.concurrency(2);
  const textureCache = new Map();
  const packedRoughnessCache = new Map();
  const retiredTextures = new Set();
  const remember = (texture) => { if (texture) retiredTextures.add(texture); };
  const loadTexture = async (filename) => {
    const resolved = absolute(filename);
    if (textureCache.has(resolved)) return textureCache.get(resolved);
    const bytes = await readFile(resolved);
    const metadata = await sharp(bytes).metadata();
    requireCondition(metadata.format === 'png', `Authored input texture must be PNG: ${relative(resolved)}`);
    const texture = document.createTexture(`Printstream/${path.basename(resolved, '.png')}`)
      .setImage(new Uint8Array(bytes)).setMimeType('image/png').setURI(path.basename(resolved));
    textureCache.set(resolved, texture);
    return texture;
  };
  const packedRoughness = async (filename) => {
    if (packedRoughnessCache.has(filename)) return packedRoughnessCache.get(filename);
    const { data, info } = await sharp(absolute(filename))
      .pipelineColourspace('b-w').toColourspace('b-w').raw()
      .toBuffer({ resolveWithObject: true });
    requireCondition(info.channels === 1, `Expected one roughness channel: ${filename}`);
    const pixels = Buffer.allocUnsafe(info.width * info.height * 3);
    for (let i = 0; i < data.length; i++) {
      pixels[i * 3] = 255;
      pixels[i * 3 + 1] = data[i];
      pixels[i * 3 + 2] = 255;
    }
    const png = await textureEncoder(pixels, { raw: { width: info.width, height: info.height, channels: 3 } }).png().toBuffer();
    const name = `${path.basename(filename, '.png')}_MR`;
    const texture = document.createTexture(`Printstream/${name}`).setImage(new Uint8Array(png))
      .setMimeType('image/png').setURI(`${name}.png`);
    packedRoughnessCache.set(filename, texture);
    return texture;
  };

  const ao = await loadTexture(aoPath);
  const aoMetadata = await sharp(ao.getImage()).metadata();
  requireCondition(aoMetadata.width === configuration.ao.resolution && aoMetadata.height === configuration.ao.resolution,
    `Expected ${configuration.ao.resolution} squared baked AO atlas; received ${aoMetadata.width}x${aoMetadata.height}.`);
  const filmExtension = document.createExtension(KHRMaterialsIridescence);
  const coatExtension = document.createExtension(KHRMaterialsClearcoat);
  for (const material of modelMaterials) {
    const spec = configuration.materials[material.getName()];
    remember(material.getBaseColorTexture());
    remember(material.getNormalTexture());
    remember(material.getMetallicRoughnessTexture());
    remember(material.getOcclusionTexture());
    material.setBaseColorFactor(spec.baseColorFactor)
      .setBaseColorTexture(spec.baseColorTexture ? await loadTexture(spec.baseColorTexture) : null)
      .setMetallicFactor(spec.metalness)
      .setRoughnessFactor(spec.roughnessTexture ? 1 : spec.roughness)
      .setMetallicRoughnessTexture(spec.roughnessTexture ? await packedRoughness(spec.roughnessTexture) : null)
      .setNormalTexture(spec.normalTexture ? await loadTexture(spec.normalTexture) : null)
      .setNormalScale(spec.normalScale)
      .setAlphaMode('OPAQUE');
    sampling(material.getBaseColorTextureInfo());
    sampling(material.getMetallicRoughnessTextureInfo());
    sampling(material.getNormalTextureInfo());
    if (spec.ao) {
      material.setOcclusionTexture(ao).setOcclusionStrength(configuration.ao.strength);
      sampling(material.getOcclusionTextureInfo(), configuration.ao.texCoord, true);
    } else {
      material.setOcclusionTexture(null);
    }
    if (spec.clearcoat.factor > 0) {
      // Reuse Blender's property so any coat normal/texture survives the cutover.
      const coat = material.getExtension(coatExtensionName) ?? coatExtension.createClearcoat();
      coat.setClearcoatFactor(spec.clearcoat.factor).setClearcoatRoughnessFactor(spec.clearcoat.roughness);
      material.setExtension(coatExtensionName, coat);
    } else {
      material.setExtension(coatExtensionName, null);
    }
    if (spec.iridescence.factor > 0) {
      const film = material.getExtension(filmExtensionName) ?? filmExtension.createIridescence();
      remember(film.getIridescenceThicknessTexture());
      film.setIridescenceFactor(spec.iridescence.factor)
        .setIridescenceIOR(spec.iridescence.ior)
        .setIridescenceThicknessMinimum(spec.iridescence.thicknessMinimum)
        .setIridescenceThicknessMaximum(spec.iridescence.thicknessMaximum)
        .setIridescenceThicknessTexture(spec.iridescence.thicknessTexture ? await loadTexture(spec.iridescence.thicknessTexture) : null);
      sampling(film.getIridescenceThicknessTextureInfo());
      material.setExtension(filmExtensionName, film);
    } else {
      material.setExtension(filmExtensionName, null);
    }
  }
  // Dispose only superseded, unreferenced image resources. Never prune nodes,
  // materials, groups, accessors, pivot empties, animation channels or mesh parts.
  for (const texture of retiredTextures) {
    if (texture.listParents().every((parent) => parent === root)) texture.dispose();
  }
  for (const texture of root.listTextures()) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(texture.getMimeType())) continue;
    await compressTexture(texture, { encoder: textureEncoder, targetFormat: 'webp', lossless: true, effort: 60 });
  }
  document.createExtension(EXTTextureWebP).setRequired(true);
  await document.transform(draco({
    method: 'edgebreaker', encodeSpeed: 5, decodeSpeed: 5,
    quantizePosition: 16, quantizeNormal: 12, quantizeTexcoord: 16,
    quantizeColor: 10, quantizeGeneric: 16, quantizationVolume: 'mesh',
  }));
  const geometry = countGeometry(document, inside);
  const bytes = await io.writeBinary(document);
  const finalJSON = glbJSON(bytes);
  checkPreservation(sourceJSON, finalJSON, configuration.requiredNodes);
  const materialReport = validateFinalMaterials(finalJSON, configuration, modelNames);
  const textureReport = [];
  for (const texture of root.listTextures()) {
    const image = texture.getImage();
    const dimensions = await sharp(image).metadata();
    textureReport.push({ name: texture.getName(), mimeType: texture.getMimeType(),
      width: dimensions.width, height: dimensions.height, bytes: image.byteLength });
  }
  const report = {
    schemaVersion: 1,
    input: relative(input), output: relative(output),
    sizeBytes: bytes.byteLength, sizeMiB: Number((bytes.byteLength / 1048576).toFixed(3)),
    rawSizeBytes: rawBytes.byteLength, compressionRatio: Number((rawBytes.byteLength / bytes.byteLength).toFixed(3)),
    ...geometry,
    drawCallDefinition: 'One draw per mesh-primitive instance in Rifle before culling, shadows and postprocessing; this is not a measured browser frame.',
    nodeCount: finalJSON.nodes.length, requiredNodes: configuration.requiredNodes,
    animations: animationSnapshot(finalJSON),
    extensionsUsed: finalJSON.extensionsUsed ?? [], extensionsRequired: finalJSON.extensionsRequired ?? [],
    ao: { path: relative(aoPath), texCoord: configuration.ao.texCoord, strength: configuration.ao.strength,
      resolution: configuration.ao.resolution, scope: configuration.export.modelRoot },
    materialDetails: materialReport, textures: textureReport,
    preservation: { namedNodes: true, hierarchy: true, localPivots: true, nodeExtras: true,
      animationTargetsAndSampleCounts: true, joinOrPruneApplied: false },
    compression: { geometry: 'Draco edgebreaker', images: 'Lossless WebP; authored dimensions retained',
      positionBits: 16, normalBits: 12, texcoordBits: 16 },
  };
  await mkdir(path.dirname(output), { recursive: true });
  await mkdir(path.dirname(statsFile), { recursive: true });
  await writeFile(output, bytes);
  await writeFile(statsFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ output: report.output, stats: relative(statsFile), triangles: report.triangles,
    drawCalls: report.drawCalls, materials: report.materialCount, sizeMiB: report.sizeMiB,
    nodes: report.nodeCount, animations: report.animations.length }, null, 2));
}

await main();
