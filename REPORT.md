# M4A1-S | Printstream — отчёт

**Сайт:** http://localhost:4102  
**Корень проекта:** `C:/Main/WorkPlace/Muse spark/cs model/Astra M4 Model`  
**Проверка текущей версии:** 2026-10-30

## Рваные тёмные контуры — текущая версия

### Причина, подтверждённая переключателями

- До изменения приложения сняты **30 кадров A–E**: hero, левый профиль, крупный план передней сборки; DPR 1 и 2, viewport 1440×900 CSS px. Idle sway заморожен. Матрицы камеры/модели и crop rectangles совпадали между вариантами; hover shell был невидим.
- [Исходная контактная таблица, 400% nearest-neighbour](artifacts/edge-diagnostics/before/contact-sheet-400pct.png). B — screen AO off, C — baked AO off, D — обе AO off, E — clearcoat roughness ≥ .12.
- **AO не была причиной воспроизведённого пунктира.** На верхней кромке глушителя B совпал с A побайтно во всех шести сочетаниях ракурса/DPR; C/D дали максимум 0–1 уровень RGB и не убрали полосу. На цевье отключение AO меняло затенение впадин, но не убирало рваную кромку. Фон исходного AO PNG уже белый, а не чёрный.
- **Подтверждён clearcoat/specular aliasing при скользящем угле.** Дополнительный H, clearcoat off, убрал тёмную кромку; normal map off и iridescence off — нет. [Дополнительная таблица F–L](artifacts/edge-diagnostics/shading-probes/contact-sheet-400pct.png). E был недостаточным тестом: у основных белых оболочек clearcoat roughness уже .14. Даже увеличение до .3 не решало точечную выборку финального Fresnel/energy mix.

### Изменения

- `src/scene/specularAA.js`: derivative-based geometric specular AA. В финальном clearcoat mix учитывается `fwidth(N·V)`; подавляется только неразрешённая субпиксельная доля покрытия у горизонта нормали. Коэффициент одинаково применяется к отражению слоя и к ослаблению нижнего материала. Разрешённые блики, параметры roughness/clearcoat и пигмент не изменены.
- `src/scene/Viewer.jsx`: AA устанавливается один раз на каждый уникальный материал с clearcoat; прежние shader/cache hooks восстанавливаются при cleanup.
- `src/scene/Effects.jsx`: основной HDR target имеет **2× ширину и высоту вывода**, то есть четыре shading samples на выходной пиксель, плюс прежний **MSAA ×4**. Штатная линейная выборка HDR выполняет 2×2 resolve перед Neutral tone mapping / sRGB. Directional FXAA и SMAA в финальный pipeline не добавлены.
- **AO сохранена**, чтобы не потерять объём: тот же baked AO, тот же SSAO с 8 samples/radius/strength и ContactShadows. SSAO остаётся половиной внутреннего HDR, теперь это полное разрешение выходного изображения.
- `src/experience.js` и `Effects.jsx`: probe renderer/scene/camera/controls и freeze-idle доступны только при запуске с `?verify=1`; при dispose ссылки очищаются. Обычный запуск не создаёт probe.
- **GLB, `.blend`, UV0, AO_UV, bake settings и AO PNG не изменены.** Переупаковка UV, повторный bake/export и резервные копии перед bake не потребовались. SHA-256 GLB до/после совпал; `aoMap.channel=1` и mipmaps сохранены.

### Статические сравнения

- [Финальная A–E таблица, все ракурсы/DPR, 400%](artifacts/edge-diagnostics/final/contact-sheet-400pct.png).
- Hero: [DPR 1](artifacts/edge-diagnostics/before-after-hero-dpr1-400pct.png), [DPR 2](artifacts/edge-diagnostics/before-after-hero-dpr2-400pct.png).
- Левый профиль: [DPR 1](artifacts/edge-diagnostics/before-after-left-dpr1-400pct.png), [DPR 2](artifacts/edge-diagnostics/before-after-left-dpr2-400pct.png).
- Крупный план: [DPR 1](artifacts/edge-diagnostics/before-after-suppressor-dpr1-400pct.png), [DPR 2](artifacts/edge-diagnostics/before-after-suppressor-dpr2-400pct.png).
- [Общий вид до/после](artifacts/edge-diagnostics/before-after-hero.png); [контакты ресивера, шахта магазина и окно спуска, до/после](artifacts/edge-diagnostics/before-after-contact-darkening.png). Полости и контактное затемнение остались; модель не переведена в diffuse/flat.
- Сохранена ровная физическая отражённая кайма металла на разрешённом крупном плане, а не пунктир/плавающая ступенчатая полоса: [crop глушителя, DPR 2, 400%](artifacts/edge-diagnostics/final/suppressor-dpr2-A-suppressor-top-4x.png).

### Движение и взаимодействия

- На каждом DPR записаны **4 кадра живого idle sway** и **13 кадров непрерывного orbit 0–360°**. Движение модели подтверждено изменением её world matrix; первая и последняя camera matrix полного оборота совпали с погрешностью менее `3e-15`.
- [Idle: три кромки, 400%](artifacts/edge-diagnostics/final/idle-edges-400pct.png); [orbit: кромка глушителя, 400%](artifacts/edge-diagnostics/final/orbit-edges-400pct.png). В просмотренных кадрах тёмный пунктир/crawl не обнаружен.
- Обзор оборота: [DPR 1](artifacts/edge-diagnostics/final/orbit-dpr1-contact-sheet.png), [DPR 2](artifacts/edge-diagnostics/final/orbit-dpr2-contact-sheet.png). Полные PNG: `final/idle-dpr{1,2}-{0..3}.png`, `final/orbit-dpr{1,2}-{00..12}.png`; camera/projection/model matrices сохранены в `final/performance-motion.json`.
- Основной фактический desktop/mobile smoke прошёл **88 проверок**, снял **30 screenshots**, без browser errors/warnings. Проверены механика семи органов управления, реальные transforms частей, fieldstrip/reassemble и блокировка механики при разборке, все шесть ракурсов, mesh hover/click, hotspot/part index, закрытие карточки, labels, auto rotate, reset, CS2 Inspect, мышь/колесо/pan, touch orbit, reduced motion и download endpoints.
- Отдельный `--inspect-inputs-only` прошёл **10 проверок** без повторения уже пройденного основного прогона: фактическая Right camera button, четыре detent buttons с совместным движением Stock/StockLever/ButtPad, клавиатурные End/Home реального fieldstrip slider, Escape и повторный вход через header.
- Результаты: `artifacts/browser-verification.json` и `artifacts/inspect-inputs-verification.json`; полный список 30 UI-кадров — поле `screens` первого файла, изображения — `artifacts/screenshots/`.

### Производительность

Production preview; Chrome headless / ANGLE D3D11 / **NVIDIA GeForce RTX 4070 Laptop GPU**, общая машина. По 240 RAF intervals на сценарий. Разрешение вывода **2560×1440 физических пикселей**: CSS 2560×1440 при DPR 1 и 1280×720 при DPR 2. Внутренний HDR финала — 5120×2880; SSAO — 2560×1440.

| Сценарий | FPS до | FPS после |
|---|---:|---:|
| DPR 1, живой idle sway | 144.0 | 138.8 |
| DPR 1, камера движется | 144.0 | 141.6 |
| DPR 2, живой idle sway | 144.0 | 139.4 |
| DPR 2, камера движется | 144.0 | 123.9 |

- Все измеренные средние выше **55 FPS**. Это результат указанной GPU, не обещание для физического телефона или другой видеокарты.
- Полный кадр: **71–142 draw calls**, **128 204–256 407 отрисованных треугольников**; верхнее значение включает дополнительный normal pass SSAO. Сам asset — **128 201 треугольник**.
- GLB: **16 618 436 байт / 15.85 MiB**, без изменения размера или содержимого.
- Данные: `artifacts/edge-diagnostics/before/performance-motion.json`, `artifacts/edge-diagnostics/final/performance-motion.json`, `artifacts/edge-diagnostics/comparison.json`.

### Скрипты и артефакты

- `scripts/diagnose_edges.mjs` — фиксированные A–E кадры, crops и nearest-neighbour sheets; дополнительный `--probe shading` для F–L.
- `scripts/compare_edges.mjs` — проверка совпадения поз/материалов/GLB hash и before/after sheets.
- `scripts/profile_edges.mjs` — production FPS и idle/orbit frames; `--motion-only` переснимает движение, не повторяя уже пройденные FPS measurements.
- `scripts/verify_site.mjs` — последовательный desktop/mobile smoke настоящих элементов управления и компонентов модели; `--inspect-inputs-only` запускает только дополнительные range/detent/keyboard сценарии и сохраняет отдельный отчёт.
- Полные кадры и crops: `artifacts/edge-diagnostics/before/`, `shading-probes/`, `final/`; индекс поз, материалов и rectangles — `before/captures.json` и `final/captures.json`.
- Сохранённые промежуточные одноразовые эксперименты: `artifacts/edge-diagnostics/sampling-probes/`, `antialias-probes/`, `fresnel-probes/`. Их экспериментальные shader/render overrides удалены из диагностического скрипта; это не финальный pipeline.
- Фактическая поверхность kept-сайта: `artifacts/edge-diagnostics/final/live-site.png`. Production build проверен через `heavy npm run build`; compile/console errors при A–E capture отсутствовали.

---

## Принятая форма по референсу — без изменений в edge-fix

Изменена геометрия, а не палитра или студийный свет. Контуры сверялись с предоставленным видом в едином масштабе и по общей оси ствола: [reference / до / после](artifacts/shape-reference-comparison.png).

- **Ресивер:** округлое сечение верхней части вместо коробки; заново построенные контуры нижней части, расширение шахты магазина, переход к рукояти и объёмные площадки органов управления. Старый большой прямоугольный карман удалён.
- **Ручка переноски:** обведены внешний контур и окно, увеличена толщина нижней перемычки, сделан настоящий утопленный задний карман. Внутренние зазоры сохранены для движущейся рукоятки заряжания и затворной группы.
- **Передняя сборка:** перестроены стойка прицела с двумя отверстиями, крепёжный выступ и нижняя петля. У цевья 12 узких разделительных рёбер, более спокойные поля панелей и объёмные продольные полосы по бокам вместо тёмного стыка «гофры».
- **Приклад:** округлая верхняя втулка, сплошная нижняя стенка вместо ошибочного большого треугольного окна, узкая сквозная прорезь и новый контур затыльника. Толщина стенки уточнена по проверке объёмного ракурса: прорезь остаётся видимой не только строго сбоку.
- **Рукоять и магазин:** переделаны изгибы и пальцевой упор, наклонная расширенная пятка и углублённые боковые поля рукояти; уточнён нижний изгиб магазина, сделаны более неглубокие штампованные каналы и тонкая пятка.
- **Окраска:** все 13 наборов PBR-параметров в реально загруженном GLB совпали с принятой версией; пигментные атласы и свет не перерисованы. UV существующей графики ресивера подогнаны под новые формы. AO перепечён для всей сборки.

### Проверка текущей формы

- GLB: **128 201 треугольник**, 43 mesh-части, 69 material primitives, 13 материалов, 45 узлов; **16 618 436 байт**. Данные: `artifacts/asset-stats.json`.
- Native Blender: нет неманифолдных рёбер, открытых границ и нулевых полигонов; сохранены `UV0`, `AO_UV`, 47 actions и 14 packed images. Перед AO/export выполнен отдельный fail-fast контроль замкнутой геометрии. Данные: `artifacts/geometry-audit.json`.
- В браузере проверены лучами настоящая сплошная стенка и отверстие приклада, открытое окно и глубина кармана ручки, округлость верхнего ресивера, наклон пятки рукояти и рельеф продольной полосы цевья. Регрессия прорези под наклоном: раньше оба контрольных луча перекрывались стенкой, теперь оба проходят.
- Проверены фактические перемещения глушителя, рукоятки заряжания и затворной группы, магазина, согласованное выдвижение трёх частей приклада, разборка, блокировка механики при разборке и возврат частей в исходное положение.
- Финальный GLB просмотрен сбоку, справа и в объёмном ракурсе, отдельно — приклад и ресивер. Ошибок браузера нет. Итоги: `artifacts/shape-smoke.json`; кадры: `artifacts/screenshots/shape-final-{left,right,hero,receiver,stock}.png`.
- Обновлены скачиваемый packed `.blend`, GLB, пять Cycles-рендеров, reference comparison, ZIP и `dist/`. Три download endpoint отвечают HTTP 200; `heavy npm run build` завершился успешно.

Контуры видимой стороны сняты с одного изображения; глубина и скрытые поверхности реконструированы, а не получены из игрового меша. Точного совпадения невидимых областей этот reference не доказывает.

---

## Предыдущий этап — исправление сглаживания

Ниже сохранены результаты предыдущей версии; её численные показатели геометрии и screenshots не являются текущими.

- **Причина артефактов:** самописный directional FXAA деформировал круглые элементы декали в крестики и смазывал тонкие линии. При его отключении в том же ракурсе точки снова становились круглыми. Фильтр и промежуточный display target удалены; основной HDR target использует MSAA ×4 до tone mapping. Runtime подтвердил четыре samples.
- **Текстуры:** аппаратная анизотропия до ×8 для цветовых и surface maps; DPR ограничен 2 вместо 1.5. Проверенный браузер фактически работал с DPR 1.25. Штатная тонкая продольная полоса Printstream сохранена, выпрямлена и отделена от артефактов сглаживания.
- **Геометрия:** 160 радиальных сегментов глушителя вместо 80, дополнительные переходные сечения фасок, 128 сегментов муфты и 96 ствола. Цевьё имеет 13 более мелких скруглённых рёбер; скруглено окно carry handle, добавлен рельеф ресивера, переделаны сечения рукояти и пальцевые выемки. Все именованные pivot-ы и иерархия сохранены.
- **Материал и свет:** у глушителя/цевья iridescence 0.4, IOR 1.3, clearcoat roughness 0.14; ослаблен постоянный радужный пигмент. Мягкий фронтальный fill и нижняя отражающая панель улучшают читаемость формы без потери светлого силуэта.
- **Текущий GLB:** 93 080 треугольников, 43 mesh-части, 65 material primitives, 13 материалов, 45 узлов; размер 16 045 032 байта. AO перепечён для всех 43 частей.
- **Проверка Blender:** нет открытых/неманифолдных границ и нулевых полигонов; оба UV-набора сохранены; 47 actions и 14 packed images. Данные: `artifacts/geometry-audit.json`.
- **Реальный browser smoke:** левый/правый профиль, крупный план глушителя и ракурс с дульной части; viewport 390×844 дополнительно проверен на том же desktop-браузере, не на физическом телефоне. Проверены фактическое перемещение/возврат глушителя и магазина, fieldstrip, запрет механики при разборке и обратная сборка. Ошибок браузера нет. Данные: `artifacts/model-quality-smoke.json`.
- **Поставка:** пересобраны GLB и packed `.blend`, все пять Cycles PNG, reference comparison и ZIP; все три download endpoint возвращают HTTP 200. `heavy npm run build` завершился успешно.

[Сравнение глушителя до/после в нативных пикселях](artifacts/model-quality-comparison.png). Новые браузерные кадры: `artifacts/screenshots/quality-after-{profile,suppressor,right,muzzle,mobile}.png`.

Модель остаётся авторской визуальной реконструкцией, не точной копией игрового меша; микрографика и невидимая на reference сторона интерпретированы.

---

**Архив исходной версии от 2026-10-29.** Разделы ниже сохраняют первоначальные измерения и полный browser run. Их численные таблицы, параметры FXAA/DPR и старые screenshots не описывают обновлённую версию; текущие значения и evidence приведены выше.

## Что построено

Авторская процедурная визуальная реконструкция по предоставленному изображению, не извлечённый игровой меш CS2. Редактируемая Blender-сцена, текстурированный GLB, пять Cycles-рендеров и интерактивная white-studio витрина на React, React Three Fiber, Drei, Three.js и GSAP ScrollTrigger.

Blender MCP использован для проверки доступности; после таймаутов MCP/CLI-маршрута работа продолжена напрямую через Blender 5.2.2 LTS в headless-режиме, как разрешено в ТЗ. Фактические геометрия, AO и рендеры выполнены Blender CLI. Два субагента: **StudioSite** — сайт/интеракции; **TexturePipeline** — декали, спецификация материалов и GLB-постпроцесс. Основная сессия — моделирование, AO, рендеры, интеграция и проверки.

### Геометрия и сборка

- 43 отдельных mesh-объекта; 45 именованных узлов с `Rifle` и группой `Magazine`. Все требуемые имена сохранены.
- Глушитель, ступенчатый ствол, половины цевья и buffer tube построены вращением реальных сечений. Цевьё имеет 11 геометрических рёбер и углубления между ними.
- Ресиверы — объёмные коробчатые секции, фаски, реальные карманы и отверстия. Сквозные окна ручки, спусковой скобы, приклада и ejection port не нарисованы текстурой.
- Рукоять и приклад собраны из нескольких сечений. Изогнутый магазин полый, с прессованными каналами. Пять патронов ориентированы пулей к дульной части; в собранном магазине выступает только верхний.
- Малые двухсегментные фаски отделены от широких моделированных скосов. Геометрия проверена на открытые/неманифолдные границы и нулевые полигоны: замечаний нет.
- Pivot-ы находятся на механических осях. `UpperReceiver` и `CarryHandle` перемещаются согласованно. Native `.blend` содержит 47 actions; GLB — собранный клип `FieldStrip`. Интерактивные движения сайта выполняются GSAP из исходных трансформаций.
- Модель — визуальный/game asset; внутренности и движения иллюстративные, не производственная или сервисная документация.

### Полный список частей

| Объект | Треугольники |
|---|---:|
| `Suppressor` | 1,600 |
| `Suppressor_Collar` | 1,004 |
| `Barrel` | 1,056 |
| `GasBlock` | 384 |
| `FrontSight` | 1,064 |
| `BayonetLug` | 200 |
| `Handguard_Top` | 5,900 |
| `Handguard_Bottom` | 5,900 |
| `HandguardCap` | 640 |
| `DeltaRing` | 768 |
| `UpperReceiver` | 4,490 |
| `CarryHandle` | 668 |
| `RearSight` | 1,256 |
| `LowerReceiver` | 8,544 |
| `TakedownPin_Front` | 760 |
| `TakedownPin_Rear` | 760 |
| `SelectorLever` | 464 |
| `BoltCatch` | 168 |
| `MagRelease` | 216 |
| `Trigger` | 116 |
| `TriggerGuard` | 116 |
| `Hammer` | 300 |
| `DustCover` | 476 |
| `ForwardAssist` | 724 |
| `ChargingHandle` | 456 |
| `BoltCarrier` | 668 |
| `Bolt` | 256 |
| `MagBody` | 10,920 |
| `MagBaseplate` | 212 |
| `MagFollower` | 108 |
| `MagSpring` | 2,698 |
| `Cartridge` | 336 |
| `Cartridge_02` | 336 |
| `Cartridge_03` | 336 |
| `Cartridge_04` | 336 |
| `Cartridge_05` | 336 |
| `PistolGrip` | 1,140 |
| `BufferTube` | 1,222 |
| `BufferSpring` | 6,730 |
| `Buffer` | 256 |
| `Stock` | 2,632 |
| `StockLever` | 624 |
| `ButtPad` | 908 |
| **Итого** | **68,084** |

В GLB 65 material primitives / draw calls геометрии, 13 материалов, 14 текстур. Пределы 300k треугольников и 150 вызовов соблюдены. Максимум, зафиксированный в кадрах браузерной проверки с дополнительными проходами/подсветкой: **137 draw calls / 137 774 отрисованных треугольника**; это не размер самого меша.

## Текстуры, материалы и свет

Единый источник значений: [`assets/materials.json`](assets/materials.json). В браузере исходные PBR-материалы GLB не подменяются другим набором параметров. Текстурированный base-color factor равен белому: пигмент #E4E5E3 уже находится в атласах и не умножается второй раз.

| Материал | Base sRGB | Metalness | Roughness | Clearcoat / roughness | Iridescence |
|---|---|---:|---:|---|---|
| Pearl receiver / magazine | #E4E5E3 | 0.04 | 0.36 + карта вариации | 1 / 0.08 | 0.28; IOR 1.3 |
| Pearl suppressor / handguard | #E4E5E3 | 0.04 | 0.36 + карта вариации | 1 / 0.08 | 1; IOR 1.7 |
| Satin steel | #141516 | 0.60 | 0.40 | 0.12 / 0.22 | 0 |
| Polymer grip / stock | #1B1B1B | 0 | 0.76 + карта вариации | 0 | 0 |
| Holographic regions | собственный rainbow-атлас | 0.18 | 0.23 | 1 / 0.055 | 1; IOR 1.3 |

- Шесть основных decal-атласов 4096×4096, отдельный holographic-атлас 4096×1024. Нормали, roughness и film maps — 2048×2048. Artwork заново нарисован скриптом, без запечённого освещения фотографии.
- UV0: отдельные боковые области; для глушителя и цевья — цилиндрическая развёртка. Левый и правый layouts различаются. Второй набор `AO_UV` экспортируется как TEXCOORD_1; Three.js читает его через `aoMap.channel = 1`.
- AO: Cycles, 64 samples, каждый из 43 mesh-объектов изолирован от остальных; непересекающиеся участки общего 2048² атласа. Сила AO 0.85. Поэтому разобранные детали не сохраняют тени от соседних деталей.
- Все 14 изображений packed в `.blend`. Финальный GLB: Draco + lossless WebP; `KHR_materials_clearcoat` и `KHR_materials_iridescence` добавлены постпроцессом. Film thickness 250–450 nm.
- Production runtime подтвердил у глушителя/цевья clearcoat=1, iridescence=1, IOR=1.7, AO channel=1, base map 4096 и film map 2048. Это проверено после реальной загрузки GLB через GLTFLoader, не только в JSON спецификации.

**Cycles:** нейтральный key сверху-слева 1100 W, rim 900 W, fill 65 W, muzzle softbox 300 W; тёмное отражающее окружение. AgX Base Contrast (`look=None`), exposure −0.25. Camera-visible cyclorama с мягкой AO-тенью не заполняет всё окружение белыми отражениями. Пять финальных кадров: 2560×1440, 96 samples, denoised, последовательный рендер.

**WebGL:** собственная softbox-сцена для PMREM с белыми источниками и тёмными промежутками; нейтральные key/rim, ContactShadows, NeutralToneMapping. Лёгкий экранный AO: половинное разрешение, 8 samples; валидная маска кэшируется, изменения проекции/глубины/видимости её обновляют. AO и tone mapping объединены, затем bounded FXAA. Основной кадр не понижается в разрешении; DPR ограничен 1.5. Bloom и звук не добавлялись.

## Сайт и управление

- Loader с holo-линией и счётчиком; поосевая начальная сборка около 1.8 s, затем плавное движение.
- Hero и пять scroll chapters. Для chapter-сцены выделена отдельная колонка; на мобильном — область над текстом, без наложения модели на copy.
- Глушитель: вращение и отсоединение/присоединение. Charging handle двигает bolt carrier и открывает dust cover. Magazine release и извлечение/возврат магазина. Приклад: четыре detent-положения.
- Finish: реальный slider поворачивает studio key; два угла сохранены в скриншотах.
- Inspect: orbit/zoom/pan, шесть камер, компактные `[+]` hotspots с occlusion/facing-проверкой, hover rim, карточки частей, Reset.
- Staged field-strip около 2.2 s: scrub 0→1, осевые группы, вычисленные bounds, leader labels. На 0.5 и 1.0 пересечений label rectangles не обнаружено. Недоступные механические действия объясняются сообщением «Reassemble to operate».
- CS2 Inspect: подъём, настоящий разворот на правую сторону, наклон и возврат. Правый бок в среднем кадре проверен по фактическому положению дульной части на экране.
- Responsive bottom sheet, настоящий touch-orbit и `prefers-reduced-motion`. Шрифты Space Grotesk и IBM Plex Mono self-hosted; OFL-файлы доступны в footer.

## Проверки и производительность

`heavy npm run build` успешно собрал production в `dist/` (Vite 7.3.7). Полная браузерная проверка: **78 проверок**, **30 скриншотов**, **0 console errors/warnings**. Проверены реальные chapter-кнопки, slider-ы, mesh picking, hotspot, мышь/колесо/pan, touch-orbit, камеры, блокировка действий при разборке, reduced motion и download endpoints.

Отдельный smoke на production preview подтвердил загрузку собранного приложения, вход в Inspect, камеру справа, фактический поворот DustCover, декодированные материалы и HTTP 200 с точным размером трёх downloads. Два дополнительных production-скриншота; console clean.

**Среда:** Chrome headless / ANGLE D3D11 / NVIDIA GeForce RTX 4070 Laptop GPU. Для headless использован `--force-high-performance-gpu`; без него Chrome выбирал Intel Iris Xe. 390×844 — эмуляция viewport/touch на той же машине, не тест физического телефона. Общая машина, 180 requestAnimationFrame samples на замер.

| Замер | Средний FPS | P95 frame, ms | GLB load, s | Реальный drawing buffer |
|---|---:|---:|---:|---|
| desktop / hero | 39.1 | 41.8 | 4.346 | 1440 × 900 |
| mobile / hero | 76.9 | 27.8 | 4.276 | 390 × 844 |
| desktop / 2560×1440 / live idle | 64.1 | 27.9 | 2.700 | 2560 × 1440 |

Цель ≥55 FPS подтверждена **в среднем** при native 2560×1440 с обычным idle sway, DPR=1; это не обещание минимальных 55 FPS в каждом кадре. Первый 1440×900 замер был ниже — 39.1 FPS; он не скрыт и не заменён повторным удачным замером. Причина разницы между прогонами не изолировалась. `loadMs` измеряет время от запуска experience-модуля до декодированной модели, **без** последующей 1.8 s сборки; это не полное navigation-to-ready время.

GLB: **16 314 552 bytes / 15.559 MiB**. Native packed `.blend`: **19 645 675 bytes**. Архив рендеров: **13 825 801 bytes**. В неподвижном кадре с валидным AO — 68 draw calls / 68 088 rendered triangles; при обновлении AO и подсветке зафиксировано до 137 / 137 774.

Полные данные: [`artifacts/browser-verification.json`](artifacts/browser-verification.json), [`artifacts/production-smoke.json`](artifacts/production-smoke.json), [`artifacts/asset-stats.json`](artifacts/asset-stats.json), [`artifacts/geometry-audit.json`](artifacts/geometry-audit.json).

## Reference vs render: фиксированные пробы

Сравнение в общей шкале длины и bore datum: [`public/renders/reference-comparison.png`](public/renders/reference-comparison.png). Исходный предоставленный 4K reference хранится в `assets/reference.png`.

RGB — средние значения encoded sRGB 0–255; Y — Rec.709-weighted сумма этих байтов, не физическая линейная luminance. Области заданы фиксированными мировыми координатами. Для pearl-статистики исключены Y≤85 и Y≥251, для чёрных частей выбран Y<130. Отдельно сохранены **нефильтрованные** пики и доля clipping, чтобы этот фильтр не скрывал пересвет.

| Часть | Reference RGB | Cycles RGB | Reference Y | Cycles Y | Cycles max−min Y | Cycles P95−P05 |
|---|---|---|---:|---:|---:|---:|
| Suppressor | 226.2 / 227.0 / 227.7 | 206.2 / 209.9 / 207.6 | 226.9 | 208.9 | 87.1 | 70.4 |
| Handguard | 224.4 / 219.7 / 215.7 | 202.6 / 208.0 / 204.2 | 220.4 | 206.6 | 108.0 | 59.3 |
| Receiver | 221.6 / 219.8 / 217.6 | 161.5 / 161.8 / 161.3 | 220.0 | 161.7 | 152.1 | 27.9 |
| Magazine | 219.4 / 218.4 / 216.1 | 150.7 / 151.2 / 150.7 | 218.5 | 151.1 | 105.1 | 87.7 |
| Grip | 83.8 / 84.1 / 83.9 | 38.2 / 37.9 / 36.6 | 84.0 | 37.9 | 127.9 | 94.7 |
| Stock | 44.7 / 44.9 / 45.3 | 23.6 / 23.6 / 23.6 | 44.9 | 23.6 | 122.6 | 36.0 |

Во всех четырёх pearl-пробах max−min превышает 60. Это именно полный диапазон, а не утверждение, что P95−P05 везде ≥60: обе величины приведены отдельно. Средняя нейтральность чёрных частей: grip Δ=1.4, stock Δ=0.0, предел 3 соблюдён. В шести нефильтрованных render-пробах нет каналов со значением 255. Пики: suppressor 243/243/242, handguard 250/251/250; один канал на рёбрах на один уровень выше желаемого 250.

Координаты crop-ов, число пикселей, reference ranges и все измерения: [`artifacts/sampled-spots.json`](artifacts/sampled-spots.json). Метод воспроизводится `scripts/compare_reference.py`.

## Известные визуальные отличия

1. **Не 1:1 игровой меш.** Окно carry handle угловатее, геометрия приклада/стойки и мелких органов управления упрощена, рёбра цевья выражены сильнее. Сравнение: [reference/render](public/renders/reference-comparison.png), [receiver](public/renders/receiver.png).
2. **Тональное совпадение не полное.** Receiver и magazine заметно темнее reference; чёрные grip/stock тоже темнее. Точные различия приведены в таблице, а не замаскированы общим «match».
3. **Artwork реконструирован.** XX/heart/barcode/circuit-язык сохранён, но микроглифы, износ и некоторые позиции не являются пиксельной копией. Правый layout — авторская интерпретация: [правый бок](artifacts/screenshots/production-right-port.png).
4. **Renderers отличаются.** WebGL даёт более насыщенную радужную реакцию, чем Cycles. [Cycles close-up](public/renders/suppressor-handguard.png), [WebGL close-up](artifacts/screenshots/desktop-03-handguard-closeup.png). Целевой верхний уровень 250 превышен на один byte в зелёном канале одной sampled области, без clipping 255.

## Файлы и структура

| Результат | Путь |
|---|---|
| Рабочий packed Blender master | `artifacts/m4a1s-printstream.blend` |
| Скачиваемый packed Blender | `public/downloads/m4a1s-printstream.blend` |
| Финальный Draco/WebP GLB | `public/models/m4a1s-printstream.glb` |
| Raw промежуточный GLB | `artifacts/m4a1s-raw.glb` |
| Пять Cycles PNG | `public/renders/left-profile.png`, `hero.png`, `suppressor-handguard.png`, `receiver.png`, `exploded.png` |
| Reference comparison | `public/renders/reference-comparison.png` |
| ZIP: пять renders + comparison | `public/downloads/renders.zip` |
| Исходные текстуры / спецификация | `assets/textures/`, `assets/materials.json` |
| Исходный reference | `assets/reference.png` |
| Сайт | `src/App.jsx`, `src/styles.css`, `src/experience.js`, `src/scene/` |
| Production | `dist/` |
| Полные browser screenshots | `artifacts/screenshots/` |
| Контактные листы | `artifacts/desktop-contact-sheet.png`, `artifacts/mobile-contact-sheet.png`, `artifacts/cycles-contact-sheet.png` |
| Render/AO журналы | `artifacts/cycles-renders.json`, `artifacts/ao-bake.json` |
| Font licences | `public/licenses/Space-Grotesk-OFL.txt`, `public/licenses/IBM-Plex-Mono-OFL.txt` |

### Скрипты

| Скрипт | Назначение |
|---|---|
| `scripts/build_model.py` | Геометрия, pivots, иерархия, actions, студия; `--bake` запускает AO/export |
| `scripts/make_textures.py` | Детерминированные 4K decals и 2K surface/film maps |
| `scripts/bake_export.py` | Изолированный AO, упаковка, raw glTF export |
| `scripts/finalize_glb.mjs` | PBR extensions, корректная roughness packing, WebP, Draco, проверки бюджета |
| `scripts/diagnose_model.py` | Топология, UV-наборы, packed images, actions, расположение патронов/follower/spring |
| `scripts/render_model.py` | Пять последовательных Cycles-кадров; `--preview`, `--shot` |
| `scripts/compare_reference.py` | Фиксированные RGB/Y пробы и side-by-side |
| `scripts/package_deliverables.py` | Download-копия blend, ZIP рендеров, OFL licences |
| `scripts/verify_site.mjs` | Реальный Chrome/WebGL smoke, screenshots и метрики; URL первым аргументом |

### Скриншоты

Для каждого суффикса существуют `artifacts/screenshots/desktop-<суффикс>.png` (1440×900) и `mobile-<суффикс>.png` (390×844):

- `01-hero`
- `02-left-profile`, `02b-mesh-hover`
- `03-handguard-closeup`, `03b-receiver-closeup`
- `04-suppressor-off`, `05-charging-back`, `06-magazine-out`, `07-stock-extended`
- `08-exploded-half`, `09-exploded-full`
- `10-finish-light-a`, `11-finish-light-b`
- `12-right-port-open`, `13-cs2-inspect-mid`

Production: `production-hero.png`, `production-right-port.png` в той же папке. Все 30 основных кадров и production-поверхность просмотрены визуально.

## Запуск

```text
heavy npm run build
own-start --keep npm run dev -- --port {port}
heavy node scripts/verify_site.mjs http://127.0.0.1:4102
```

Полный rebuild ассета: `make_textures.py` → Blender CLI `build_model.py -- --bake` → `finalize_glb.mjs` → Blender CLI с загруженным master и `render_model.py` → `compare_reference.py` → `package_deliverables.py` → build сайта. Blender вызывается с `--threads 4 --debug-depsgraph-no-threads --python-exit-code 1`; Cycles/AO — через `heavy`, последовательно. Скрипт рендера должен запускаться **с загруженным .blend**, а не на пустой startup-сцене.

## Обработанные проблемы

- **Tool/harness:** таймауты Blender MCP → native CLI; нестабильность многопоточного depsgraph → сериализованный depsgraph; headless Chrome выбирал Intel → явный выбор доступной RTX для измеренного desktop-прогона.
- **Код:** исправлены parent transforms магазина, AO UV после Edit Mode, ориентация/высота патронов, serialisation GSAP cache, лишний shadow pass, shader warnings, chapter framing и отсутствовавший полный разворот Inspect.
- **QA locator:** production-кнопка имеет accessible name `right` (визуальная заглавная буква — CSS); исправлен smoke locator, код сайта не менялся.
- **Look/design:** выбран нейтральный контрастный свет; оставшиеся геометрические/тональные отличия перечислены выше.

## Credits

Неофициальная fan-made визуальная работа по предоставленному reference. Counter-Strike / CS2 и Printstream принадлежат соответствующим правообладателям; это не официальный продукт Valve. Новые mesh/decals созданы в проекте. Space Grotesk и IBM Plex Mono распространяются по приложенным OFL-лицензиям. Платные модели, HDRI, шрифты и звуки не использовались.
