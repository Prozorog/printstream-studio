// Roughness filtering does not filter Three's final clearcoat energy mix.
// A normal footprint crossing the view horizon is not a resolved coat sample:
// fade only that subpixel contribution, retaining the unchanged finish elsewhere.
const coatComposite = 'outgoingLight = outgoingLight * ( 1.0 - material.clearcoat * Fcc ) + ( clearcoatSpecularDirect + clearcoatSpecularIndirect ) * material.clearcoat;'
const filteredComposite = `
  float clearcoatFootprint = max(fwidth(dot(geometryClearcoatNormal, geometryViewDir)), 0.0001);
  float resolvedClearcoat = material.clearcoat * smoothstep(0.0, clearcoatFootprint, dotNVcc);
  outgoingLight = outgoingLight * (1.0 - resolvedClearcoat * Fcc)
    + (clearcoatSpecularDirect + clearcoatSpecularIndirect) * resolvedClearcoat;
`

function filterClearcoatShader(shader) {
  if (!shader.fragmentShader.includes(coatComposite)) {
    throw new Error('Clearcoat AA: the installed Three physical shader contract has changed.')
  }
  shader.fragmentShader = shader.fragmentShader.replace(coatComposite, filteredComposite)
}

export function installSpecularAA(material) {
  if (!(material.clearcoat > 0)) return null
  const beforeCompile = material.onBeforeCompile
  const cacheKey = material.customProgramCacheKey
  material.onBeforeCompile = function (shader, renderer) {
    beforeCompile.call(this, shader, renderer)
    filterClearcoatShader(shader)
  }
  material.customProgramCacheKey = function () { return `${cacheKey.call(this)}:clearcoat-footprint-aa` }
  material.needsUpdate = true
  return () => {
    material.onBeforeCompile = beforeCompile
    material.customProgramCacheKey = cacheKey
    material.needsUpdate = true
  }
}
