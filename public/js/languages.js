/* Languages — bundled text pools for non-English racing. English stays on
 * live TypeRacer + Monkeytype data; the other languages race on these
 * curated pools (folk proverbs / short wisdom sentences — public domain,
 * no attribution games). Pool entries are 90–240 chars: short proverbs
 * joined into race-sized paragraphs, ASCII-style punctuation so every
 * keyboard can type them. 'dir' drives the RTL typing flow for fa/ar. */

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export const LANGUAGES = {
  en: { name: 'English', flag: '🇬🇧', dir: 'ltr', pool: [] },

  fa: {
    name: 'فارسی', flag: '🇮🇷', dir: 'rtl',
    pool: [
      { text: 'عجله کار شیطان است. هر کاری را که می خواهی، در وقت خودش انجام بده؛ شتاب همیشه دوست تو نیست.', source: 'ضرب المثل فارسی' },
      { text: 'سفر نیمه عمر است. هر جا که می روی، چیزی یاد می گیری که هیچ کتابی به تو نمی آموزد.', source: 'نثر فارسی' },
      { text: 'صبوری کلید هر دری است که به رویت بسته است. دل را چون بشکافی، هر دانه اش صد سخن دارد.', source: 'ضرب المثل فارسی' },
      { text: 'علم بهتر است یا ثروت؟ آن که دانا نیست، دلش تنگ است. دانش پنجره ای است رو به دنیایی روشن.', source: 'نثر فارسی' },
      { text: 'درخت که بارش بیش است، سرش فروتر. بزرگ مردان خود را کوچک می کنند و کوچک مردان خود را بزرگ.', source: 'ضرب المثل فارسی' },
      { text: 'طبیعت هیچ وقت دیر نمی کند؛ بهار که برسد، گل ها بی منت شکوفه می دهند. تو هم مثل بهار باش.', source: 'نثر فارسی' },
      { text: 'کسی که به دیگران امید بخشد، در دل شب نیز نور می یابد. امید چراغی است که خاموشی ندارد.', source: 'نثر فارسی' },
      { text: 'پشت کار و پشت گرمی، کوه را هم می برد. قطره نیست که سنگ را می شکافد، پیوستگی است.', source: 'ضرب المثل فارسی' },
      { text: 'دوستی قوی تر از خویشاوندی است. دوست آن است که در تاریکی و در سختی کنارت بایستد.', source: 'نثر فارسی' },
      { text: 'هر که بامش بیش، برفش بیشتر. قدر و مقام، بار مسئولیت می آورد، نه آسایش.', source: 'ضرب المثل فارسی' },
      { text: 'مردم دنیا به زبان خوب و خویشتن داری جذب می شوند. نرمی گفتار، درهای بسته را باز می کند.', source: 'نثر فارسی' },
      { text: 'بی آموختن زندگی زیباست ولی بی زندگی، آموختن ممکن نیست. هر روز چیزی بیاموز و هر روز زندگی کن.', source: 'نثر فارسی' },
      { text: 'از دل رفتنی تا دل نباشد، فایده ندارد. مهربانی زبانی ندارد اما هر دل آن را می فهمد.', source: 'نثر فارسی' },
      { text: 'سختی های امروز، قصه های فردا هستند. آن روز که سخت می گذرد، بدان که داری بالغ می شوی.', source: 'نثر فارسی' },
      { text: 'چشمه که جاری است، آبش تازه است. به حرکت و تلاش ادامه بده؛ ایستادن، فساد می آورد.', source: 'نثر فارسی' },
      { text: 'باد را نمی توانی ببینی اما اثرش را در بال و پر می بینی. خوبی ها هم چنین اند؛ خودشان حرف نمی زنند.', source: 'نثر فارسی' },
      { text: 'زبان خوش، جان بخش است. با لبخند و کلام شیرین می توانی دنیا را به پیش پای خود بیاری.', source: 'ضرب المثل فارسی' },
      { text: 'خاک که پست شد، گل داد و بلند شد. فروتنی آغاز بلندا است، غرور آغاز فرو ریختن.', source: 'ضرب المثل فارسی' },
      { text: 'از فکر بسته بپرهیز. دری که با فکر باز می شود، هیچ چفت دیگری نمی تواند ببندد.', source: 'نثر فارسی' },
      { text: 'بهار را نمی شود زود آورد، اما می شود در سبزش کاشت. امروز روز تو است؛ آن را کاشتی کن.', source: 'نثر فارسی' },
    ],
  },

  es: {
    name: 'Español', flag: '🇪🇸', dir: 'ltr',
    pool: [
      { text: 'Más vale tarde que nunca. No dejes para mañana lo que puedas hacer hoy; el que madruga, Dios le ayuda.', source: 'refrán español' },
      { text: 'Camarón que se duerme se lo lleva la corriente. En casa del herrero, cuchillo de palo.', source: 'refrán español' },
      { text: 'A buen hambre no hay pan duro. Más vale pájaro en mano que ciento volando.', source: 'refrán español' },
      { text: 'El que mucho abarca, poco aprieta. Querer es poder; donde hay voluntad, hay camino.', source: 'refrán español' },
      { text: 'Obras son amores, que no buenas razones. Dime con quién andas y te diré quién eres.', source: 'refrán español' },
      { text: 'Al mal tiempo, buena cara. Después de la tormenta siempre viene la calma.', source: 'refrán español' },
      { text: 'No por mucho madrugar amanece más temprano. Cada cosa a su tiempo y el tiempo en su lugar.', source: 'refrán español' },
      { text: 'La práctica hace al maestro. Errar es humano; aprender de los errores es pura sabiduría.', source: 'refrán español' },
      { text: 'Árbol que nace torcido, jamás su rama endereza. De tal palo, tal astilla.', source: 'refrán español' },
      { text: 'Más vale poco y bueno que mucho y malo. Lo breve, si bueno, dos veces bueno.', source: 'refrán español' },
      { text: 'Quien siembra vientos recoge tempestades. Con la vara que midas serás medido.', source: 'refrán español' },
      { text: 'El tiempo es oro: pierde dinero y lo recuperas; pierde tiempo y no vuelve nunca.', source: 'refrán español' },
      { text: 'Una golondrina no hace verano. Solo los valientes conocen el sabor de la victoria.', source: 'refrán español' },
      { text: 'Barriga llena, corazón contento. La risa es la mejor medicina que existe para el alma.', source: 'refrán español' },
      { text: 'Vale más saber que tener. El saber no ocupa lugar, y la lectura es la llave del saber.', source: 'refrán español' },
      { text: 'Amor con amor se paga; la bondad siempre vuelve multiplicada a quien la reparte.', source: 'refrán español' },
      { text: 'Zapatero a tus zapatos. El pez grande se come al chico, pero el río es de todos.', source: 'refrán español' },
      { text: 'Poco a poco se anda lejos. Gota a gota se llena el vaso, paso a paso se llega a la cima.', source: 'refrán español' },
    ],
  },

  fr: {
    name: 'Français', flag: '🇫🇷', dir: 'ltr',
    pool: [
      { text: "Petit à petit, l'oiseau fait son nid. Rien ne sert de courir; il faut partir à point.", source: 'proverbe français' },
      { text: "Après la pluie vient le beau temps. Il faut savoir attendre la fin de l'orage.", source: 'proverbe français' },
      { text: "Qui ne risque rien n'a rien. La fortune sourit toujours aux audacieux.", source: 'proverbe français' },
      { text: "L'habit ne fait pas le moine. Ne juge pas un livre par sa couverture.", source: 'proverbe français' },
      { text: "Il ne faut pas mettre la charrue avant les bœufs. Chaque chose en son temps.", source: 'proverbe français' },
      { text: "Loin des yeux, loin du cœur. Mais une vraie amitié traverse toutes les distances.", source: 'proverbe français' },
      { text: 'La nuit porte conseil. Demain est un autre jour, plein de nouvelles chances.', source: 'proverbe français' },
      { text: 'Mieux vaut prévenir que guérir. Une petite précaution épargne bien des regrets.', source: 'proverbe français' },
      { text: "Le temps c'est de l'argent. Ce qui est fait n'est plus à faire.", source: 'proverbe français' },
      { text: 'Tous les chemins mènent à Rome. L\'important n\'est pas la route, c\'est le pas qui l\'avance.', source: 'proverbe français' },
      { text: "À chaque jour suffit sa peine. Vis le présent; le passé est parti, l'avenir n'est pas là.", source: 'proverbe français' },
      { text: "On récolte ce que l'on sème. Sème le bien, même s'il ne pousse pas tout de suite.", source: 'proverbe français' },
      { text: "La parole est d'argent, mais le silence est d'or. Écoute deux fois, parle une fois.", source: 'proverbe français' },
      { text: 'Vouloir c\'est pouvoir. La volonté déplace des montagnes, une goutte à la fois.', source: 'proverbe français' },
      { text: "Le monde appartient à ceux qui se lèvent tôt. Et à ceux qui ne s'endorment pas sur leurs rêves.", source: 'proverbe français' },
      { text: 'Charbonnier est maître chez soi. Chacun chez soi, chacun son royaume.', source: 'proverbe français' },
      { text: "Pierre qui roule n'amasse pas mousse. Mais qui ne roule pas ne découvre pas le monde.", source: 'proverbe français' },
      { text: "Il n'y a pas de fumée sans feu. Et il n'y a pas de roses sans épines.", source: 'proverbe français' },
    ],
  },

  de: {
    name: 'Deutsch', flag: '🇩🇪', dir: 'ltr',
    pool: [
      { text: 'Übung macht den Meister. Aller Anfang ist schwer, aber jeder Schritt lohnt sich.', source: 'Sprichwort' },
      { text: 'Morgenstund hat Gold im Mund. Wer früh aufsteht, hat mehr vom Tag.', source: 'Sprichwort' },
      { text: 'Stille Wasser sind tief. Nicht jeder, der viel spricht, hat auch viel zu sagen.', source: 'Sprichwort' },
      { text: 'Wer rastet, der rostet. Bleib in Bewegung, dann bleibt auch der Kopf frisch.', source: 'Sprichwort' },
      { text: 'Auch ein blindes Huhn findet mal ein Korn. Wer nichts wagt, gewinnt nichts.', source: 'Sprichwort' },
      { text: 'Der Apfel fällt nicht weit vom Stamm. Doch jeder schreibt seine eigene Geschichte.', source: 'Sprichwort' },
      { text: 'Was du heute kannst besorgen, das verschiebe nicht auf morgen. Zeit ist das kostbarste Gut.', source: 'Sprichwort' },
      { text: 'Viele Köche verderben den Brei. Aber viele Hände machen jede Last leicht.', source: 'Sprichwort' },
      { text: 'Reden ist Silber, Schweigen ist Gold. Wer zuhört, lernt mehr als wer plappert.', source: 'Sprichwort' },
      { text: 'Hochmut kommt vor dem Fall. Wer bescheiden bleibt, steht sicher im Sturm.', source: 'Sprichwort' },
      { text: 'Der frühe Vogel fängt den Wurm. Doch Geduld fängt mehr als Eile.', source: 'Sprichwort' },
      { text: 'Ein Übel kommt selten allein. Aber auch das Glück kommt oft in Scharen.', source: 'Sprichwort' },
      { text: 'Wie man in den Wald hineinruft, so schallt es heraus. Freundlichkeit kehrt zurück.', source: 'Sprichwort' },
      { text: 'Rom wurde nicht an einem Tag erbaut. Große Dinge brauchen Zeit und Ruhe.', source: 'Sprichwort' },
      { text: 'Not macht erfinderisch. Aus jeder Krise wächst eine neue Stärke.', source: 'Sprichwort' },
      { text: 'Lieber spät als nie. Aber am besten beginnt man gleich heute.', source: 'Sprichwort' },
      { text: 'Ehrlichkeit ist die beste Politik. Ein gutes Wort kostet nichts und bringt viel.', source: 'Sprichwort' },
      { text: 'Wo ein Wille ist, ist auch ein Weg. Der erste Schritt ist immer der schwerste.', source: 'Sprichwort' },
    ],
  },

  tr: {
    name: 'Türkçe', flag: '🇹🇷', dir: 'ltr',
    pool: [
      { text: 'Damlaya damlaya göl olur. Az az biriken emekler bir gün bütüne ulaşır.', source: 'atasözü' },
      { text: 'Ağaç yaş iken eğilir. Eğitim küçük yaşta kolaydır, geç kalmak işi zorlaştırır.', source: 'atasözü' },
      { text: 'İyilik eden iyilik bulur; kötülük de kendi yolunu mutlaka bulur.', source: 'atasözü' },
      { text: 'Bir elin nesi var, iki elin sesi var. Birlik ve dayanışma her gücü aşar.', source: 'atasözü' },
      { text: 'Dost ağlatır, düşman güldürür. Gerçek dost ancak zor günlerde yanı başındadır.', source: 'atasözü' },
      { text: 'Akıl yaştan değil, baştan değildir. Gençler de öğretebilir, yaşlılar da öğrenebilir.', source: 'atasözü' },
      { text: 'Sabreden derviş muradına ermiş. Sabır, tüm kapıları açan anahtardır.', source: 'atasözü' },
      { text: 'Ne oldum dememeli, ne olacağım demeli. Geçmiş değil, gelecek önemlidir.', source: 'atasözü' },
      { text: 'Çıkmayan candan ümit kesilmez. Umut olduğu sürece her zaman bir yol vardır.', source: 'atasözü' },
      { text: 'Gülü seven dikenine katlanır. Her güzel şeyin bir çabası, bir bedeli vardır.', source: 'atasözü' },
      { text: 'Sakla samanı, gelir zamanı. Bugün hazırladığın şey, yarının güvencesidir.', source: 'atasözü' },
      { text: 'Öfkeyle kalkan zararla oturur. Önce düşün, sonra konuş; pişmanlık geç kalır.', source: 'atasözü' },
      { text: 'Tatlı dil yılanı deliğinden çıkarır. Güzel söz kapıları açar, kalpler yumuşatır.', source: 'atasözü' },
      { text: 'Kervan yolda düzülür. Yola çıkmaktan korkma; yol kendini yürüdükçe gösterir.', source: 'atasözü' },
      { text: 'Her yiğidin bir yoğurt yiyişi vardır. Herkesin yolu ve üslubu başkadır.', source: 'atasözü' },
      { text: 'Üzüm üzüme baka baka kararır. Kimlerle dostluk kurduğun seni şekillendirir.', source: 'atasözü' },
      { text: 'El elden üstündür. Kimseyi küçümseme; herkesin bir bildiği bir de görmediği vardır.', source: 'atasözü' },
      { text: 'Emek olmadan yemek olmaz. Çalışkanlık, şansın en güvenilir hâlidir.', source: 'atasözü' },
    ],
  },

  ru: {
    name: 'Русский', flag: '🇷🇺', dir: 'ltr',
    pool: [
      { text: 'Терпение и труд всё перетрут. Без труда не вытащишь и рыбку из пруда.', source: 'пословица' },
      { text: 'Слово не воробей: вылетит - не поймаешь. Сначала подумай, потом говори.', source: 'пословица' },
      { text: 'Не имей сто рублей, а имей сто друзей. Настоящий друг дороже золота.', source: 'пословица' },
      { text: 'Тише едешь - дальше будешь. Спешка хороша при ловле блох, и только.', source: 'пословица' },
      { text: 'Готовь сани летом, а телегу зимой. Кто предупреждён, тот вооружён.', source: 'пословица' },
      { text: 'Семь раз отмерь, один раз отрежь. Спешить в деле - только портить дело.', source: 'пословица' },
      { text: 'Не всё то золото, что блестит. Судить надо по делам, а не по обложке.', source: 'пословица' },
      { text: 'Делу время, потехе час. Работа любит порядок, усердие и тишину.', source: 'пословица' },
      { text: 'Один в поле не воин. Вместе легче и тянуть, и петь, и горы свернуть.', source: 'пословица' },
      { text: 'Ученье - свет, а неученье - тьма. Книга - маленькое окно в большой мир.', source: 'пословица' },
      { text: 'Куй железо, пока горячо. Не откладывай на завтра то, что можно сделать сегодня.', source: 'пословица' },
      { text: 'Как аукнется, так и откликнется. Относись к людям так, как хочешь к себе.', source: 'пословица' },
      { text: 'На чужой каравай рта не разевай. Своё лучше добывать своим трудом.', source: 'пословица' },
      { text: 'Век живи - век учись. Каждый день приносит новый урок, если глаза открыты.', source: 'пословица' },
      { text: 'Язык мой - друг мой, и враг мой. Доброе слово лечит, злое калечит.', source: 'пословица' },
      { text: 'Что посеешь, то и пожнёшь. Доброта возвращается сторицей к тому, кто сеет её.', source: 'пословица' },
      { text: 'В тихом омуте черти водятся. Не суди о человеке по его молчанию.', source: 'пословица' },
      { text: 'Рыба ищет где глубже, а человек - где лучше. Стремление к лучшему и есть жизнь.', source: 'пословица' },
    ],
  },

  ar: {
    name: 'العربية', flag: '🇸🇦', dir: 'rtl',
    pool: [
      { text: 'الصبر مفتاح الفرج. من صبر ظفر، ومن عجل خسر. فلا سبيل إلى النتائج الحسنة بلا انتظار طويل.', source: 'مثل عربي' },
      { text: 'الوقت كالسيف إن لم تقطعه قطعك. نظّم يومك قبل أن يُنظَّم عليك، فالأيام تمر سريعاً كالظل.', source: 'مثل عربي' },
      { text: 'العلم نور والجهل ظلام. اقرأ، فالكتاب دواء لكل داء، ونافذة إلى عوالم لا نراها بأعيننا.', source: 'مثل عربي' },
      { text: 'يد واحدة لا تصفق. التعاون يرفع البناء العالي، ويتضاعف به الرزق، ويخفف به الكدّ.', source: 'مثل عربي' },
      { text: 'الجار قبل الدار. اختيار الجار يسبق اختيار البيت، لأن الحياة مع الجيران طويلة والدار قصيرة.', source: 'مثل عربي' },
      { text: 'الطيور على أشكالها تقع. لكل فرد رفقة تشبهه وتشد قواه، فاختر رفقتك بعناية ووعي.', source: 'مثل عربي' },
      { text: 'درهم وقاية خير من قنطار علاج. الاستعداد قبل الحدث نصف النصر، والتهيئة بداية الطريق.', source: 'مثل عربي' },
      { text: 'الصديق وقت الضيق. الصديق الحقيقي لا يظهر إلا عند الشدائد، فيبقى ولا يفرق.', source: 'مثل عربي' },
      { text: 'ما عملت في حياتك، وجدت بعد مماتك. فالراسيات من الصالحات تبقى، وكل عمل له أثر.', source: 'مثل عربي' },
      { text: 'العقل السليم في الجسم السليم. اقرأ واركض ونم مبكراً، فالجسم سلالة والعقل بدنة.', source: 'مثل عربي' },
      { text: 'من جد وجد، ومن زرع حصد. لا حصاد بلا بذور ولا نجاح بلا جهد ولا قمة بلا تسلق.', source: 'مثل عربي' },
      { text: 'الطمع يخسر والقناعة غنم. الرضا سر الراحة، وهو ثروة حقيقية لا تشتريها الدنانير.', source: 'مثل عربي' },
      { text: 'خير الكلام ما قل ودل. الكلام الكثير يفقد قيمته، والقصار المفيد أفصل من الطويل.', source: 'مثل عربي' },
      { text: 'رحلة ألف ميل تبدأ بخطوة واحدة. ابدأ بالصغير اليوم، وتنمو إلى الكبير غداً بإصرارك.', source: 'مثل عربي' },
      { text: 'الإنسان عدو ما جهل. تعلم لتفهم، وافهم لتسامح، وتسامح لتسعد، وازرع المعرفة حيث تذهب.', source: 'مثل عربي' },
      { text: 'الشجرة المثمرة تُرمى بالحجارة. النجاح يجذب الانتقاد أيضاً، فلا تحزن لصوت المنتقدين.', source: 'مثل عربي' },
      { text: 'من طلب العلا سهر الليالي. النجاح ثمنه التعب والمثابرة، ومن دفع الثمن بلغ قممه.', source: 'مثل عربي' },
      { text: 'أعز البلاد أرقّ بلاد. الوطن بيت الحنين، وأينما كنت فالوطن مصباحك ومرساك الأخير.', source: 'مثل عربي' },
    ],
  },
};

/* random pick, or a deterministic one when a seed string is given (daily) */
export function pickPoolText(langId, seedStr = null) {
  const lang = getLanguage(langId);
  if (!lang.pool.length) return null;
  if (seedStr == null) return lang.pool[Math.floor(Math.random() * lang.pool.length)];
  return lang.pool[hashStr(seedStr) % lang.pool.length];
}

export function getLanguage(id) { return LANGUAGES[id] ?? LANGUAGES.en; }
