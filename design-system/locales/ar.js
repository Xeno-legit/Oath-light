/*!
 * Oath Light — locales/ar.js — Arabic (العربية), RTL.
 * ------------------------------------------------------------------------
 * ⚠️  UNREVIEWED MACHINE DRAFT. `reviewed: false` below is load-bearing —
 * it is what makes the language picker label this "unreviewed draft"
 * instead of offering it as a finished translation.
 *
 * Why it ships anyway: RTL is the actual engineering work (see
 * ROADMAP.md), and RTL cannot be built or tested against an empty
 * locale. This file exists so the direction plumbing, the mirrored
 * layout, and the picker are exercisable end to end today. The words
 * are a starting point for a translator, not a finished translation.
 *
 * Before flipping `reviewed` to true, a fluent speaker needs to read
 * every string in context — not just check the grammar. Half of these
 * are addressed to someone in a hard moment, where a register that is
 * slightly too formal, too clinical, or too harsh does real damage.
 * The Companion/Drill Sergeant split in particular does not survive a
 * literal translation: it has to be re-decided in Arabic.
 *
 * Rules that survive translation (see VOICE.md):
 *   - Both voices must stay present for every key.
 *   - panic.* stays supportive in BOTH voices. Serious gets firmer,
 *     never harsher — someone reading it is already in trouble.
 *   - notify.* must never describe WHAT was browsed, only that an
 *     event happened.
 *   - {placeholders} are copied verbatim. Translating one silently
 *     breaks the interpolation and prints the literal brace text.
 * ------------------------------------------------------------------------
 */
(function (root) {
  'use strict';

  if (!root.OL_STRINGS || typeof root.OL_STRINGS.registerLocale !== 'function') return;

  root.OL_STRINGS.registerLocale({
    code: 'ar',
    name: 'Arabic',
    nativeName: 'العربية',
    dir: 'rtl',
    reviewed: false,
    strings: {
      /* --- app.* --------------------------------------------------- */
      'app.greeting_morning': { companion: 'صباح الخير، {name}', serious: 'صباحك، {name}.' },
      'app.greeting_afternoon': { companion: 'مساء الخير، {name}', serious: 'مساؤك، {name}.' },
      'app.greeting_evening': { companion: 'مساء الخير، {name}', serious: 'مساؤك، {name}.' },
      'app.welcome_title': { companion: 'أهلًا بعودتك.', serious: 'أبلِغ عن حالك.' },
      'app.welcome_sub': {
        companion: 'أنت في اليوم {days} من سلسلتك. كل اختيار صافٍ هو صوت لصالح الشخص الذي تصير إليه.',
        serious: '{days} يومًا وأنت صامد. اثبت. هذه هي المهمة كلها اليوم.',
      },
      'app.streak_line': { companion: 'اليوم {days}', serious: 'اليوم {days}. واصل.' },
      'app.cta_see_progress': { companion: 'اعرض تقدّمي', serious: 'أرِني الأرقام' },
      'app.cta_talk_it_through': { companion: 'لنتحدث في الأمر', serious: 'ضع خطة' },

      /* --- blocked.* ----------------------------------------------- */
      'blocked.status_pill': { companion: 'الحماية مُفعّلة', serious: 'الحماية مُفعّلة' },
      'blocked.headline': { companion: 'خذ نفسًا عميقًا', serious: 'توقّف.' },
      'blocked.body': {
        companion: 'حُجبت هذه الصفحة لمساعدتك على البقاء مركّزًا على أهدافك.',
        serious: 'هذه الصفحة محجوبة. هذا ما اتفقنا عليه. التزم به.',
      },
      'blocked.message': {
        companion: 'أنت تتقدّم. في كل مرة ترى فيها هذه الصفحة، أنت تختار النمو على الاندفاع.',
        serious: 'كل حجب تمرين. أنت تزداد قوة سواء شعرت بذلك أم لا.',
      },
      'blocked.cta_leave': { companion: 'العودة إلى الأمان', serious: 'عُد إلى الأمان. الآن.' },
      'blocked.cta_panic': { companion: 'أحتاج المساعدة الآن', serious: 'أحتاج المساعدة الآن' },
      'blocked.stat_blocked_label': { companion: 'المواقع المحجوبة', serious: 'المواقع المحجوبة' },
      'blocked.stat_days_label': { companion: 'أيام الحماية', serious: 'أيام الحماية' },
      'blocked.reason_lockdown': {
        companion: 'وضع الإغلاق مُفعّل — لا يمكن الوصول إلا إلى قائمتك المسموح بها الآن.',
        serious: 'وضع الإغلاق مُفعّل. لا شيء متاح غير قائمتك المسموح بها. هذا قرارك أنت.',
      },

      /* --- popup.* ------------------------------------------------- */
      'popup.protection_on': { companion: 'الحماية مُفعّلة', serious: 'الحماية مُفعّلة' },
      'popup.protection_sub': { companion: 'تصفية نشطة في هذا المتصفح', serious: 'تصفية نشطة في هذا المتصفح' },
      'popup.block_input_placeholder': { companion: 'أدخل رابطًا لحجبه', serious: 'أضف موقعًا لإغلاقه' },
      'popup.block_button': { companion: 'احجب', serious: 'احجب' },
      'popup.block_success': { companion: 'تم حجب «{domain}».', serious: '«{domain}» انتهى أمره. محجوب.' },
      'popup.block_error_invalid': {
        companion: 'أدخل نطاقًا صحيحًا (مثل example.com)',
        serious: 'نطاق غير صالح. جرّب example.com.',
      },
      'popup.block_error_duplicate': { companion: 'موجود بالفعل في قائمة الحجب.', serious: 'محجوب بالفعل. جيد.' },
      'popup.block_error_default': { companion: 'محجوب افتراضيًا بالفعل.', serious: 'مشمول افتراضيًا بالفعل.' },
      'popup.block_error_generic': { companion: 'تعذّر الحفظ. حاول مرة أخرى.', serious: 'لم يُحفظ. أعِد المحاولة.' },
      'popup.stat_blocked_label': { companion: 'المواقع المحجوبة', serious: 'المواقع المحجوبة' },
      'popup.stat_streak_label': { companion: 'أيام متتالية', serious: 'أيام متتالية' },
      'popup.open_manager': { companion: 'قائمة الحجب', serious: 'قائمة الحجب' },
      'popup.footer_synced': { companion: 'متزامن', serious: 'متزامن' },

      /* --- status.* ------------------------------------------------ */
      'status.protected': { companion: 'الحماية نشطة', serious: 'الحماية نشطة' },
      'status.ext_missing': { companion: 'الإضافة مفقودة — أصلِح', serious: 'الإضافة مفقودة. أصلِح هذا الآن.' },
      'status.ext_partial': { companion: 'حماية جزئية — أصلِح', serious: 'تغطية جزئية. أصلِح هذا الآن.' },
      'status.connecting': { companion: 'جارٍ الاتصال…', serious: 'جارٍ الاتصال…' },
      'status.not_installed': { companion: 'غير مُثبّت', serious: 'غير مُثبّت' },
      'status.browser_protection_title': { companion: 'حماية المتصفح', serious: 'حماية المتصفح' },
      'status.browsers_protected_count': { companion: '{protected}/{total} محمي', serious: '{protected}/{total} محمي' },

      /* --- friction.* ---------------------------------------------- */
      'friction.pending_label': { companion: 'تغيير قيد الانتظار', serious: 'تغيير قيد الانتظار' },
      'friction.request_submitted': {
        companion: 'تم إرسال الطلب. تبقى الحماية مُفعّلة بالكامل أثناء الانتظار.',
        serious: 'سُجّل الطلب. تبقى الحماية مُفعّلة بالكامل حتى ينتهي الوقت.',
      },
      'friction.time_remaining_hm': {
        companion: 'يتبقى {hours} س و{minutes} د — الحماية نشطة',
        serious: 'يتبقى {hours} س و{minutes} د. ما زالت نشطة. ما زالت مُفعّلة.',
      },
      'friction.time_remaining_m': {
        companion: 'يتبقى {minutes} د — الحماية نشطة',
        serious: 'يتبقى {minutes} د. ما زالت نشطة. ما زالت مُفعّلة.',
      },
      'friction.cancel_request': { companion: 'إلغاء الطلب', serious: 'اسحب الطلب' },
      'friction.keep': { companion: 'أبقِ الحماية مُفعّلة', serious: 'أبقِ الحماية مُفعّلة' },
      'friction.ready_prompt': {
        companion: 'انتهت مدة الانتظار. ماذا تريد أن تفعل؟',
        serious: 'انتهى الانتظار. قرّر، الآن.',
      },

      /* --- lockdown.* ---------------------------------------------- */
      'lockdown.start_button': { companion: 'ابدأ الإغلاق', serious: 'ابدأ الإغلاق' },
      'lockdown.active_label': { companion: 'الإغلاق نشط', serious: 'الإغلاق نشط' },
      'lockdown.remaining_note': { companion: 'متبقٍ · الإغلاق نشط', serious: 'متبقٍ. مُغلق. ابقَ مكانك.' },
      'lockdown.frozen_label': {
        companion: 'مُجمّد — لا يمكن إلغاؤه، بل انتظاره حتى ينتهي',
        serious: 'مُجمّد. لا إلغاء. تحمّله حتى النهاية.',
      },
      'lockdown.frozen_note': {
        companion: 'هذا الإغلاق مُجمّد — لا توجد حقًا أي طريقة لإلغائه. هذا هو المقصود منه حين بدأ.',
        serious: 'أنت جمّدته عن قصد. لا مخرج مبكر. جيد. هذه كانت الخطة.',
      },
      'lockdown.end_early': { companion: 'إنهاء الإغلاق مبكرًا', serious: 'إنهاء الإغلاق مبكرًا' },
      'lockdown.keep_locked': { companion: 'أبقِه مُغلقًا', serious: 'أبقِه مُغلقًا' },

      /* --- panic.* — supportive in BOTH voices --------------------- */
      'panic.entry_cta': { companion: 'أحتاج المساعدة الآن', serious: 'أحتاج المساعدة الآن' },
      'panic.eyebrow_safe': { companion: 'أنت في أمان هنا', serious: 'أنت في أمان هنا' },
      'panic.breathe_title': { companion: 'لنتنفّس أولًا.', serious: 'تنفّس. أولًا.' },
      'panic.breathe_sub': {
        companion: 'شهيق لأربع، احبس لأربع، زفير لأربع، احبس لأربع. لا شيء عليك إصلاحه الآن — فقط تابع الدائرة.',
        serious: 'شهيق لأربع، احبس لأربع، زفير لأربع، احبس لأربع. تابع الدائرة. لا شيء آخر عليك الآن.',
      },
      'panic.wave_title': { companion: 'هذا سيمرّ.', serious: 'هذا سيمرّ.' },
      'panic.wave_body': {
        companion: 'تبدو الرغبة هائلة، لكنها موجة — تبلغ ذروتها بعد نحو عشرين دقيقة ثم تنحسر سواء أطعمتها أم لا. لست مضطرًا لمقاومتها. دعها تمرّ فحسب. أنا هنا معك.',
        serious: 'الرغبة موجة. تبلغ ذروتها بعد نحو عشرين دقيقة ثم تنحسر في الحالتين. لست مضطرًا لمقاومتها — فقط اصمد أطول منها. ابقَ معي.',
      },
      'panic.wave_cta': { companion: 'ما زلت هنا', serious: 'ما زلت هنا.' },
      'panic.ground_title': { companion: 'عُد إلى الغرفة.', serious: 'عُد إلى الغرفة.' },
      'panic.ground_cta': { companion: 'تم — التالي', serious: 'تم. التالي.' },
      'panic.exit_title': { companion: 'أحسنت. حقًا.', serious: 'صمدت. جيد.' },
      'panic.exit_body': {
        companion: 'الرغبة الآن أضعف مما كانت حين وصلت. اختر إلى أين تذهب بعد ذلك — إلى مكان يغذّي الشخص الذي تصير إليه.',
        serious: 'الرغبة الآن أضعف مما كانت حين بدأت. اختر ما التالي — واجعله ذا قيمة.',
      },
      'panic.exit_cta_redirect': { companion: 'خذني إلى مكان جيد', serious: 'خذني إلى مكان جيد' },
      'panic.exit_cta_home': { companion: 'العودة إلى Oath Light', serious: 'العودة إلى Oath Light' },

      /* --- streak.* ------------------------------------------------ */
      'streak.day_count': { companion: '{days} يومًا نظيفًا', serious: '{days} يومًا. احتفظ بها.' },
      'streak.best_streak_label': { companion: 'أفضل سلسلة', serious: 'أفضل سلسلة' },
      'streak.milestone_banner': {
        companion: '{days} يومًا نظيفًا — هذا إنجاز حقيقي.',
        serious: '{days} يومًا مضت. مكتسبة، لا ممنوحة.',
      },
      'streak.milestone_sub': {
        companion: 'كل يوم منها كان اختيارًا. تستحقّه عن جدارة.',
        serious: 'كل يوم منها كان اختيارًا اتخذته عن قصد. التالي يبدأ الآن.',
      },
      'streak.slip_button': { companion: 'حدثت لي كبوة', serious: 'سجّل كبوة' },
      'streak.slip_confirm_title': { companion: 'هذا يبقى بيننا', serious: 'سجّلها كما هي.' },
      'streak.slip_confirm_body': {
        companion: 'الكبوة ليست انهيارًا — إنها لحظة واحدة، وليست هويتك. تسجيلها بصدق جزء من التعافي، لا تقرير فشل. أفضل سلسلة لديك وكل ما تعلّمته يبقيان كما هما تمامًا.',
        serious: 'الكبوة لحظة واحدة، لا حكم نهائي. سجّلها كما هي، بلا تبرير. أفضل سلسلة لديك تبقى مسجّلة. انهض.',
      },
      'streak.slip_logged_title': { companion: 'حسنًا. ما زلت هنا.', serious: 'سُجّلت. عُد إلى المعركة.' },
      'streak.slip_logged_body': {
        companion: 'الوضع اللطيف مُفعّل لأربع وعشرين ساعة. تُصفَّر سلسلتك، لكن أفضل سلسلة لديك وتقدّم هذا الشهر لا يختفيان. ما الذي قد يساعدك الآن؟',
        serious: 'السلسلة تُصفَّر. أفضل سلسلة لا تتغيّر. اختر الخطوة التالية وخُذها.',
      },
      'streak.gentle_title': { companion: 'كن لطيفًا', serious: 'انهض.' },
      'streak.gentle_sub': { companion: 'مع نفسك اليوم', serious: 'عُد إلى المعركة. اليوم.' },

      /* --- notify.* — event only, never WHAT was browsed ----------- */
      'notify.uninstall_requested_subject': {
        companion: 'Oath Light: طُلب إلغاء التثبيت على حاسوب {name}',
        serious: 'Oath Light: طُلب إلغاء التثبيت على حاسوب {name}',
      },
      'notify.uninstall_requested_body': {
        companion: 'هناك مدة انتظار قبل أن يكتمل، وما زال بالإمكان إلغاؤه. هذا مجرد تنبيه كي تتمكن من الاطمئنان.',
        serious: 'مدة انتظار جارية قبل أن يكتمل. ما زال بالإمكان إلغاؤه. يستحق الاطمئنان.',
      },
      'notify.lockdown_cancelled_subject': {
        companion: 'Oath Light: أُلغي وضع الإغلاق مبكرًا على حاسوب {name}',
        serious: 'Oath Light: أُلغي وضع الإغلاق مبكرًا على حاسوب {name}',
      },
      'notify.lockdown_cancelled_body': {
        companion: 'أُنهي وضع الإغلاق في Oath Light قبل انتهاء مؤقّته. لا تتم مشاركة أي شيء عمّا جرى تصفّحه — فقط أن ذلك حدث.',
        serious: 'أُنهي الإغلاق قبل انتهاء المؤقّت. لا تتم مشاركة أي شيء عمّا جرى تصفّحه — فقط أن ذلك حدث.',
      },
      'notify.serious_disable_requested_subject': {
        companion: 'Oath Light: طُلب إيقاف الوضع الصارم على حاسوب {name}',
        serious: 'Oath Light: طُلب إيقاف الوضع الصارم على حاسوب {name}',
      },
      'notify.serious_disable_requested_body': {
        companion: 'هناك مدة انتظار قبل أن يتوقف الوضع الصارم، ويبقى مُفعّلًا بالكامل طوال تلك المدة. هذا مجرد تنبيه كي تتمكن من الاطمئنان.',
        serious: 'مدة انتظار جارية قبل أن يتوقف الوضع الصارم. يبقى مُفعّلًا بالكامل حتى ذلك الحين. يستحق الاطمئنان.',
      },

      /* --- serious.* ----------------------------------------------- */
      'serious.enable_confirm': {
        companion: 'هل تريد تفعيل الوضع الصارم؟ هذا ينقل كل شيء إلى أشدّ الإعدادات وإلى النبرة الأقسى، في كل مكان.',
        serious: 'فعّل الوضع الصارم. أشدّ الإعدادات، نبرة قاسية، في كل مكان. نقرة واحدة. بلا أنصاف حلول.',
      },
      'serious.enable_button': { companion: 'فعّل الوضع الصارم', serious: 'فعّل الوضع الصارم' },
      'serious.active_label': { companion: 'الوضع الصارم مُفعّل', serious: 'الوضع الصارم: مُفعّل' },
      'serious.active_sub': {
        companion: 'أشدّ الإعدادات والنبرة القاسية مُفعّلة في كل مكان.',
        serious: 'أشدّ الإعدادات. نبرة قاسية. في كل مكان. بلا استثناءات.',
      },
      'serious.disable_request_warning': {
        companion: 'إيقاف هذا يبدأ مدة انتظار — يبقى الوضع الصارم مُفعّلًا بالكامل طوالها، ويُبلَّغ جهة اتصالك الموثوقة إن كنت قد عيّنت واحدة.',
        serious: 'إيقاف هذا يبدأ مدة انتظار. يبقى مُفعّلًا بالكامل حتى تنتهي. تُبلَّغ جهة اتصالك الموثوقة، إن عيّنت واحدة. هذا كان الاتفاق.',
      },
      'serious.disable_request_button': { companion: 'اطلب الإيقاف', serious: 'اطلب الإيقاف' },
      'serious.disable_pending': {
        companion: 'سيتوقف بعد {hours} س و{minutes} د — يبقى الوضع الصارم مُفعّلًا حتى ذلك الحين.',
        serious: 'يتوقف بعد {hours} س و{minutes} د. ما زال مُفعّلًا حتى ذلك الحين. بلا اختصارات.',
      },

      /* --- onboarding.* -------------------------------------------- */
      'onboarding.voice_title': {
        companion: 'اختر الطريقة التي يخاطبك بها Oath Light',
        serious: 'اختر الطريقة التي يخاطبك بها Oath Light',
      },
      'onboarding.voice_sub': {
        companion: 'اختر نبرة. يمكنك تغييرها في أي وقت، ما لم يكن الوضع الصارم مُفعّلًا.',
        serious: 'اختر نبرة. يمكنك تغييرها لاحقًا — ما لم يتجاوزها الوضع الصارم.',
      },
      'onboarding.companion_name': { companion: 'الرفيق', serious: 'الرفيق' },
      'onboarding.companion_desc': {
        companion: 'دافئ وثابت وصريح. شخص في صفّك.',
        serious: 'دافئ وثابت. شخص في صفّك.',
      },
      'onboarding.serious_name': { companion: 'المدرّب الصارم', serious: 'المدرّب الصارم' },
      'onboarding.serious_desc': {
        companion: 'قصير ومباشر وبلا تلطيف. مدرّب قاسٍ لكنه في صفّك تمامًا.',
        serious: 'قصير. مباشر. بلا تلطيف. مدرّب قاسٍ، في صفّك تمامًا.',
      },
    },
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
