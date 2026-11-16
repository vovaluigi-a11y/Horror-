// «Мои идеи»: пользователь пишет свою идею (хоть одно слово — «больница»),
// алгоритм достраивает из неё полноценную идею того же формата, что и обычные:
// формат записи, место, аномалия, персонаж, финал, оценка — и дальше та же раскадровка.
// Два пути: языковая модель среды (если доступна) или встроенный разбор по ключевым словам.

import { FORMATS, ANOMALIES, ENTITIES, ENDINGS, LOCATIONS, OPERATORS, TIMES } from './content.js';
import { rng } from './engine/timeline.js';
import { uid } from './store.js';
import { buildIdea, preferenceProfile, weighted, AFFINITY } from './ideas.js';
import { extractJSON } from './bridge.js';

const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
const byId = (arr, id) => arr.find(x => x.id === id);

// ---------- Свои места (то, чего нет в библиотеке студии) ----------
const PLACES = [
  { re: /больниц|госпитал|поликлиник|стационар|приёмн|приемн|палат/, loc: { name: 'Городская больница', short: 'больница', wide: 'длинный больничный коридор с кафелем до середины стены, каталки вдоль стен, ряд дверей палат', path: 'коридор отделения уходит в темноту, двери палат приоткрыты, в конце — пост дежурной медсестры', details: ['пустая каталка со смятой простынёй', 'журнал дежурств, где последняя запись сделана завтрашним числом', 'капельница, которая всё ещё капает у пустой койки'], light: 'холодный люминесцентный свет, половина ламп мигает', palette: 'бледно-зелёный кафель, белые простыни, ржавые подтёки' }, ent: ['doctor', 'nurse'], anom: ['step_closer', 'queue', 'sheets_chair', 'warm_chair', 'counted_doors', 'eyes_closed'] },
  { re: /морг|патолог|анатом/, loc: { name: 'Больничный морг', short: 'морг', wide: 'подвальный морг, металлические столы в ряд, стена холодильных ячеек', path: 'узкий проход между столами к дальней двери холодильника', details: ['бирка на ноге без имени, только номер оператора', 'одна ячейка холодильника открыта изнутри', 'весы, стрелка которых медленно движется сама'], light: 'резкий белый свет над столами, остальное в темноте', palette: 'нержавеющая сталь, белый кафель, жёлтые бирки' }, ent: ['doctor', 'tall_coat'], anom: ['sheets_chair', 'mannequin_breath', 'eyes_closed', 'step_closer'] },
  { re: /психиатр|психушк|дурдом|лечебниц/, loc: { name: 'Психиатрическая лечебница', short: 'лечебница', wide: 'отделение лечебницы: решётки на окнах, общий зал с привинченными стульями', path: 'коридор изолятора с мягкими дверями и окошками для подачи еды', details: ['рисунки пациентов, на всех один и тот же человек', 'смирительная рубашка, аккуратно сложенная на стуле', 'окошко в двери изнутри исцарапано'], light: 'тусклый жёлтый свет дежурного освещения', palette: 'серо-голубые стены, облезлая краска, белые халаты' }, ent: ['doctor', 'nurse'], anom: ['children_drawings', 'step_closer', 'eyes_closed', 'loop_corridor'] },
  { re: /школ|класс|учени/, loc: { name: 'Средняя школа', short: 'школа', wide: 'пустой школьный коридор, стенды с фотографиями выпускников, крашеные стены', path: 'коридор второго этажа ведёт к кабинету, дверь которого заперта снаружи', details: ['доска с недописанной фразой', 'журнал, где в списке класса появилась лишняя фамилия', 'портрет на стене, который смотрит в другую сторону'], light: 'серый свет из высоких окон, сумерки', palette: 'зелёная краска, коричневый паркет, белый мел' }, ent: ['child', 'teacher'], anom: ['extra_student', 'portrait_turn', 'children_drawings', 'clock_317'] },
  { re: /метро|станци|тоннел|туннел/, loc: { name: 'Станция метро', short: 'станция', wide: 'пустая платформа ночной станции метро, колонны, табло без надписей', path: 'служебный тоннель уходит от торца платформы в темноту', details: ['табло с временем прибытия «00:00»', 'эскалатор едет вниз сам по себе', 'на рельсах стоит детский ботинок'], light: 'дежурное освещение, жёлтые лампы через одну', palette: 'мрамор, латунь, чёрная пустота тоннеля' }, ent: ['conductor', 'tall_coat'], anom: ['step_closer', 'loop_corridor', 'queue', 'counted_doors'] },
  { re: /лес|чащ|роща|тайг/, loc: { name: 'Лес у старой дороги', short: 'лес', wide: 'еловый лес в тумане, просека, старая грунтовая дорога', path: 'тропа уходит между стволов, на деревьях — выцветшие ленты', details: ['лента на ветке, завязанная совсем недавно', 'брошенный рюкзак, промокший насквозь', 'кострище, которое ещё дымится'], light: 'серый рассеянный свет, туман глушит дальний план', palette: 'тёмная хвоя, серый туман, бурая листва' }, ent: ['tall_coat', 'deer_man'], anom: ['step_closer', 'dog_stare', 'loop_corridor', 'eyes_closed'] },
  { re: /церк|храм|часовн|монастыр/, loc: { name: 'Заброшенная церковь', short: 'церковь', wide: 'полуразрушенный храм, облупленные фрески, лучи света сквозь купол', path: 'проход к алтарю между рядами упавших подсвечников', details: ['фреска, где у всех святых закрашены лица', 'свеча горит, хотя здесь давно никого нет', 'свежие следы на пыли у иконостаса'], light: 'косые лучи из окон купола, глубокие тени', palette: 'выцветшая охра, золото, серая пыль' }, ent: ['priest', 'tall_coat'], anom: ['portrait_turn', 'step_closer', 'eyes_closed', 'warm_chair'] },
  { re: /тюрьм|колони|изолятор|сизо|камер[аеу]/, loc: { name: 'Закрытая тюрьма', short: 'тюрьма', wide: 'тюремный блок, два яруса камер, сетка между этажами', path: 'коридор между камерами, все двери открыты, кроме одной', details: ['на стене камеры нацарапаны даты до 2031 года', 'миска с едой ещё тёплая', 'глазок в двери светится изнутри'], light: 'жёсткий верхний свет через решётки', palette: 'серый бетон, синяя краска, ржавая сталь' }, ent: ['guard', 'numbered_man'], anom: ['counted_doors', 'step_closer', 'queue', 'loop_corridor'] },
  { re: /завод|фабрик|цех|комбинат/, loc: { name: 'Остановленный завод', short: 'завод', wide: 'огромный цех, ряды станков, кран-балка под крышей', path: 'проход между станками к конторке мастера', details: ['табельные карточки, отмеченные сегодняшним числом', 'станок, который ещё тёплый', 'плакат по технике безопасности с выцарапанными глазами'], light: 'серый свет сквозь грязные фонари крыши', palette: 'ржавчина, машинное масло, серый бетон' }, ent: ['gasmask', 'worker'], anom: ['queue', 'counted_doors', 'gas_masks', 'ventilation_breath'] },
  { re: /подвал|погреб|бойлерн|котельн/, loc: { name: 'Подвал жилого дома', short: 'подвал', wide: 'низкий подвал, трубы под потолком, сырые бетонные стены', path: 'узкий проход между трубами уходит дальше, чем позволяет дом', details: ['дверь с номером квартиры, которой нет в доме', 'детская коляска в углу', 'капли на трубе падают вверх'], light: 'одна голая лампочка и луч фонаря', palette: 'серый бетон, ржавые трубы, зелёная плесень' }, ent: ['tall_coat', 'child'], anom: ['extra_room', 'ventilation_breath', 'loop_corridor', 'step_closer'] },
  { re: /кладбищ|могил|погост/, loc: { name: 'Старое кладбище', short: 'кладбище', wide: 'старое кладбище в тумане, кривые кресты и оградки', path: 'тропа между оградками к часовне в глубине', details: ['свежая могила без таблички', 'фотография на памятнике — сегодняшняя дата', 'чьи-то следы, ведущие прямо в ограду'], light: 'сумерки, низкое серое небо', palette: 'чёрный металл оградок, серый камень, бурая трава' }, ent: ['tall_coat', 'smile_family'], anom: ['smiling_photos', 'step_closer', 'portrait_turn', 'dog_stare'] },
  { re: /детск(ий|ого) дом|детдом|приют|интернат/, loc: { name: 'Детский дом', short: 'детдом', wide: 'спальня детского дома, два ряда одинаковых железных кроватей', path: 'коридор с рисунками на стенах ведёт к игровой комнате', details: ['все кровати заправлены, кроме одной', 'рисунок с высоким человеком у кровати', 'качели во дворе качаются без ветра'], light: 'бледный утренний свет сквозь занавески', palette: 'белое бельё, голубые стены, выцветшие игрушки' }, ent: ['child', 'nurse'], anom: ['children_drawings', 'extra_student', 'sheets_chair', 'eyes_closed'] },
  { re: /поезд|вагон|электричк|плацкарт|купе/, loc: { name: 'Ночной поезд', short: 'вагон', wide: 'плацкартный вагон ночью, занавески, спящие силуэты на полках', path: 'проход вагона тянется дальше, чем может быть в одном вагоне', details: ['стакан в подстаканнике дрожит без стука колёс', 'билет на станцию, которой нет на карте', 'все пассажиры лежат лицом к стене'], light: 'синий ночной свет, редкие вспышки фонарей за окном', palette: 'синий дерматин, серые простыни, чёрные окна' }, ent: ['conductor', 'tall_coat'], anom: ['loop_corridor', 'eyes_closed', 'step_closer', 'counted_doors'] },
  { re: /отел|гостиниц|хостел|мотел/, loc: { name: 'Старая гостиница', short: 'гостиница', wide: 'длинный коридор гостиницы, ковровая дорожка, одинаковые двери', path: 'коридор этажа без окон ведёт к номеру в самом конце', details: ['табличка «Не беспокоить» висит на всех дверях', 'ключ от номера, которого нет в гостинице', 'звонок на ресепшене звенит сам'], light: 'тёплые бра через одну, тёмные провалы между ними', palette: 'бордовый ковёр, тёмное дерево, жёлтые обои' }, ent: ['duty_woman', 'tall_coat'], anom: ['extra_room', 'counted_doors', 'loop_corridor', 'step_closer'] },
  { re: /бункер|убежищ|шахт|объект/, loc: { name: 'Секретный бункер', short: 'бункер', wide: 'бетонный коридор бункера, гермодвери, трафаретные надписи', path: 'лестница вниз к уровню, которого нет на схеме', details: ['противогазы на крючках, один ещё влажный', 'журнал смены, последняя запись — «он внутри»', 'гермодверь заперта изнутри'], light: 'красное аварийное освещение', palette: 'серый бетон, красный свет, хаки' }, ent: ['gasmask', 'soldier'], anom: ['stairs_13', 'gas_masks', 'ventilation_breath', 'extra_room'] },
  { re: /деревн|изб|сел[оа]|хутор|ферм/, loc: { name: 'Вымершая деревня', short: 'деревня', wide: 'улица заброшенной деревни, покосившиеся избы, туман над полем', path: 'дорожка через заросший огород к избе с горящим окном', details: ['в окне избы горит лампа, хотя электричества нет', 'на крыльце стоят свежие валенки', 'собака сидит у дороги и смотрит в одну точку'], light: 'серые сумерки, одно тёплое окно', palette: 'серое дерево, бурая трава, белый туман' }, ent: ['old_woman', 'tall_coat'], anom: ['dog_stare', 'warm_chair', 'step_closer', 'smiling_photos'] },
];

// ---------- Свои персонажи ----------
const OWN_ENTITIES = {
  doctor: { re: /врач|доктор|хирург/, name: 'Врач', desc: 'врач в старом белом халате и хирургической маске, шапочка надвинута на глаза, руки в перчатках опущены вдоль тела', orig: 7 },
  nurse: { re: /медсестр|санитар/, name: 'Медсестра', desc: 'медсестра в выцветшем халате и белом колпаке, лицо бледное, голова чуть наклонена набок', orig: 7 },
  child: { re: /ребён|ребен|девочк|мальчик|дет[иья]/, name: 'Ребёнок', desc: 'ребёнок в старой школьной форме, стоит неподвижно, волосы закрывают лицо', orig: 6 },
  teacher: { re: /учител|учительниц|завуч/, name: 'Учительница', desc: 'строгая учительница в тёмном платье, указка в руке, глаз не видно за бликами очков', orig: 7 },
  priest: { re: /монах|священ|поп\b|батюшк/, name: 'Монах', desc: 'фигура в чёрной монашеской рясе с капюшоном, лица не видно', orig: 6 },
  guard: { re: /охранник|надзират|сторож/, name: 'Сторож', desc: 'сторож в ватнике и шапке, держит фонарь, но фонарь не горит', orig: 6 },
  worker: { re: /рабоч|мастер|слесар/, name: 'Рабочий', desc: 'рабочий в промасленной спецовке, вместо лица — тень под каской', orig: 6 },
  soldier: { re: /солдат|военн|офицер/, name: 'Солдат', desc: 'солдат в старой шинели и противогазе, стоит по стойке смирно', orig: 6 },
  old_woman: { re: /старух|бабк|бабушк/, name: 'Старуха', desc: 'сгорбленная старуха в платке, улыбается беззубым ртом', orig: 6 },
  deer_man: { re: /олен|рог/, name: 'Человек с рогами', desc: 'очень худая фигура с ветвистыми рогами, неестественно длинные руки', orig: 8 },
  clown: { re: /клоун|аниматор/, name: 'Клоун', desc: 'клоун в выцветшем костюме, грим потёк, улыбка нарисована шире рта', orig: 6 },
  shadow: { re: /тень|силуэт|чёрн(ый|ая) человек|черн(ый|ая) человек/, name: 'Чёрный силуэт', desc: 'плоский чёрный силуэт человека без деталей, свет его не освещает', orig: 7 },
};
const LIB_ENT_RE = { tall_coat: /пальто|высок/, conductor: /контрол[её]р|проводни/, gasmask: /противогаз/, rabbit: /заяц|кролик/, duty_woman: /дежурн|вахт[её]р/, masked_kids: /маск/, operator_double: /двойник/, swimmer: /пловец|купальщ|утопленн/, smile_family: /семь[яию]|улыбк/ };

const entityById = id => OWN_ENTITIES[id] ? { id, ...OWN_ENTITIES[id] } : byId(ENTITIES, id);
const PLACE_BASE = { orig: 8, atm: 8, vis: 8 };

function numberFrom(text) { const m = text.match(/(?:№|номер|#)\s*(\d{1,4})/i) || text.match(/(?:^|[^\d.:])(\d{1,3})(?![\d.:])/); return m ? m[1] : null; }

// Разбор текста пользователя: место, персонаж, подходящие аномалии
export function analyzeOwnText(text) {
  const t = text.toLowerCase().replace(/ё/g, 'е');
  let place = PLACES.find(p => p.re.test(t));
  // места нет, но есть персонаж — берём его «родное» место (врач → больница)
  if (!place) {
    const home = { doctor: /больниц/, nurse: /больниц/, teacher: /школ/, child: /детдом/, priest: /церк/, guard: /тюрьм/, soldier: /бункер/, worker: /завод/, old_woman: /деревн/, deer_man: /лес/ };
    for (const [id, e] of Object.entries(OWN_ENTITIES)) if (e.re.test(t) && home[id]) { place = PLACES.find(p => home[id].test(p.re.source) || home[id].test(p.loc.name.toLowerCase())); if (place) break; }
  }
  let loc = null, prefEnt = [], prefAnom = [];
  if (place) { loc = { id: 'own_place', ...PLACE_BASE, ...place.loc, details: [...place.loc.details] }; prefEnt = place.ent; prefAnom = place.anom; }
  else {
    const lib = LOCATIONS.find(l => t.includes(l.short.toLowerCase().replace(/ё/g, 'е').slice(0, Math.max(4, l.short.length - 2))));
    if (lib) loc = { ...lib, details: [...lib.details] };
  }
  if (!loc) {
    // места нет в словаре — берём слова пользователя как название, остальное достраиваем нейтрально
    const nm = cap(text.trim().split(/[.,;!?\n]/)[0].slice(0, 40));
    loc = { id: 'own_place', ...PLACE_BASE, name: nm, short: nm.toLowerCase(), wide: `${nm.toLowerCase()}, пустое пространство, следы недавнего присутствия людей`, path: `проход вглубь: ${nm.toLowerCase()} оказывается больше, чем кажется снаружи`, details: ['опрокинутый стул посреди помещения', 'на стене выцарапана сегодняшняя дата', 'старый телефон, трубка снята и лежит рядом'], light: 'слабый холодный свет, глубокие тени по углам', palette: 'выцветшие серые и зелёные тона, тёмные углы' };
  }
  const num = numberFrom(text);
  if (num && !/\d/.test(loc.name)) loc.name = `${loc.name} №${num}`;
  // персонаж из текста
  let entity = null;
  for (const [id, e] of Object.entries(OWN_ENTITIES)) if (e.re.test(t)) { entity = entityById(id); break; }
  if (!entity) for (const [id, re] of Object.entries(LIB_ENT_RE)) if (re.test(t)) { entity = byId(ENTITIES, id); break; }
  if (/никого|пуст[оа]|без людей/.test(t)) entity = byId(ENTITIES, 'absence');
  return { loc, entity, prefEnt, prefAnom, placeKnown: !!place };
}

// Встроенный путь: 3 варианта полноценной идеи из текста пользователя
export function makeOwnIdeas(text, history, count = 3, seed = Date.now()) {
  const r = rng(seed);
  const profile = preferenceProfile(history);
  const an = analyzeOwnText(text);
  const out = [], usedA = new Set();
  for (let k = 0; k < count * 12 && out.length < count; k++) {
    const anomaly = weighted(r, ANOMALIES, x => (an.prefAnom.includes(x.id) ? 6 : 1) * (x.hook + x.orig)).id;
    if (usedA.has(anomaly)) continue; usedA.add(anomaly);
    let e = an.entity;
    if (!e) {
      // для узнаваемого места — «его» персонаж (больница → врач), иногда второй типичный или подходящий аномалии
      const pool = r() < 0.65 && an.prefEnt.length ? [an.prefEnt[0]] : [...an.prefEnt, ...(AFFINITY[anomaly] || [])];
      e = entityById(pool.length ? pool[Math.floor(r() * pool.length)] : 'tall_coat') || ENTITIES[0];
    }
    const format = weighted(r, FORMATS, x => x.orig + x.atm).id;
    const ending = weighted(r, ENDINGS, x => x.twist).id;
    const parts = { format, location: an.loc.id, anomaly, entity: e.id, ending, operator: OPERATORS[Math.floor(r() * OPERATORS.length)], time: TIMES[Math.floor(r() * TIMES.length)] };
    const objs = { f: byId(FORMATS, format), l: an.loc, a: byId(ANOMALIES, anomaly), e, en: byId(ENDINGS, ending) };
    const idea = buildIdea(parts, r, profile, objs);
    idea.custom = { location: an.loc };
    if (OWN_ENTITIES[e.id]) idea.custom.entity = e;
    idea.own = true; idea.userText = text.trim();
    idea.source = 'Моя идея → встроенный алгоритм';
    if (text.trim().length > 25) idea.logline = `Ваш замысел: «${text.trim()}». ` + idea.logline;
    if (!an.placeKnown) idea.reason += ' Место взято из вашего текста дословно — детали места достроены общими, их можно уточнить в Сценарной.';
    out.push(idea);
  }
  return out.sort((a, b) => b.score - a.score);
}

// ---------- Путь через языковую модель среды ----------
export function ownIdeaRequest(text, styles) {
  return `Ты — сценарист коротких хоррор-видео (analog horror, found footage, VHS). Пользователь дал свою идею:
«${text.trim()}»

Разверни её в 3 разных полноценных варианта для вертикального ролика до 25 секунд в виде найденной архивной записи. Сохрани суть и место из идеи пользователя. Стиль: ${styles || 'analog horror, found footage, VHS'}.
Каждый вариант — одна чёткая аномалия, понятная без слов; всё снимаемо статичными кадрами; в финале должен быть персонаж для скримера (лицо или фигура крупно).

Ответь ТОЛЬКО JSON:
{"ideas":[{"title":"","logline":"суть в 2–3 предложениях","visual":"главный образ","detail":"пугающая деталь","ending":"финал","score":8.0,"reason":"почему такая оценка",
"year":1994,"format":"тип записи","found":"как нашли запись (одна фраза)","camera":"чем снято",
"place":{"name":"название места (если в идее есть номер — сохрани)","wide":"общий план места","path":"проход вглубь","details":["деталь 1","деталь 2","деталь 3"],"light":"свет","palette":"палитра"},
"entity":{"name":"кто появляется","desc":"внешность одной фразой, одинаковая во всех кадрах"},
"anomaly":{"text":"что не так (продолжение фразы «становится ясно, что…»)","hint":"как аномалия едва видна","reveal":"как она раскрывается","clue":"улика","detail":"пугающая деталь"},
"endingVisual":"последний кадр"}]}`;
}

export function parseOwnIdeas(text, userText, source = 'Моя идея → ИИ') {
  const j = extractJSON(text);
  const arr = Array.isArray(j) ? j : j.ideas;
  if (!Array.isArray(arr) || !arr.length) throw new Error('ИИ не вернул идеи');
  const S = (v, d = '') => String(v ?? d).trim() || d;
  return arr.slice(0, 5).map(x => {
    const p = x.place || {}, e = x.entity || {}, a = x.anomaly || {};
    const year = Math.max(1960, Math.min(2015, Number(x.year) || 1995));
    const fmtLib = FORMATS.find(f => S(x.format).toLowerCase().includes(f.name.toLowerCase().split(' ')[0].slice(0, 5)));
    const format = { ...(fmtLib || FORMATS[0]), id: 'own_format', name: S(x.format, fmtLib?.name || 'Найденная кассета'), found: S(x.found, fmtLib?.found || 'кассету нашли при разборе архива'), camera: S(x.camera, fmtLib?.camera || 'бытовая VHS-камера'), era: [year, year] };
    const details = (Array.isArray(p.details) ? p.details : []).map(d => S(d)).filter(Boolean);
    const loc = { id: 'own_place', ...PLACE_BASE, name: S(p.name, cap(userText.slice(0, 40))), short: S(p.name, userText).toLowerCase(), wide: S(p.wide, S(p.name, userText)), path: S(p.path, 'проход вглубь помещения'), details: details.length ? details : ['следы недавнего присутствия людей'], light: S(p.light, 'слабый холодный свет'), palette: S(p.palette, 'выцветшие тона') };
    const noEnt = /^(нет|никого|—|-)?$/i.test(S(e.name));
    const entity = noEnt ? byId(ENTITIES, 'absence') : { id: 'own_entity', name: S(e.name), desc: S(e.desc, S(e.name)), orig: 7 };
    const anomaly = { id: 'own_anomaly', text: S(a.text, S(x.logline)), title: [S(x.title)], visual: S(x.visual), hint: S(a.hint, 'в глубине кадра что-то не так'), reveal: S(a.reveal, S(x.visual)), clue: S(a.clue, S(x.detail)), detail: S(a.detail, S(x.detail)), orig: 8, vis: 8, hook: 8 };
    const ending = { id: 'own_ending', text: S(x.ending), visual: S(x.endingVisual, S(x.ending)), twist: 8 };
    return {
      id: uid('i'), title: S(x.title, 'Моя идея'), logline: S(x.logline), visual: S(x.visual), detail: S(x.detail), ending: S(x.ending),
      score: Math.max(1, Math.min(10, Number(x.score) || 7.5)), reason: S(x.reason), crit: null,
      parts: { format: fmtLib?.id || FORMATS[0].id, location: 'own_place', anomaly: 'own_anomaly', entity: entity.id, ending: 'own_ending', operator: OPERATORS[0], time: TIMES[0] },
      custom: { format, location: loc, entity: entity.id === 'absence' ? undefined : entity, anomaly, ending },
      year, own: true, userText: userText.trim(), source,
    };
  }).sort((a, b) => b.score - a.score);
}
