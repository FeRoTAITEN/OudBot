// app.js – Oud Dashboard single-page app (vanilla JS, no build step)
(() => {
  'use strict';

  // ---------------------------------------------------------------- i18n
  const L = {
    ar: {
      appName: 'لوحة عود', tagline: 'إدارة كاملة للبوت',
      overview: 'نظرة عامة', servers: 'السيرفرات', music: 'التشغيل الحي', bots: 'البوتات', logs: 'السجلات',
      broadcast: 'الإعلانات', security: 'الأمان والنسخ', more: 'المزيد', logout: 'خروج', owner: 'مالك', guildMgr: 'مدير سيرفر', roleOwner: 'المالك', roleManager: 'مدير', roleAdmin: 'مشرف', roleSubs: 'مشرف اشتراكات', roleMember: 'عضو',
      online: 'متصل', offline: 'غير متصل', ping: 'الاستجابة', uptime: 'مدة التشغيل', boot: 'زمن الإقلاع',
      subscribed: 'سيرفرات مشتركة', streams: 'تشغيل حي', voice: 'اتصالات صوت', slaves: 'بوتات مساعدة', errors: 'أخطاء آخر ساعة',
      cpu: 'المعالج', ram: 'الذاكرة', pids: 'العمليات', warmStarts: 'بدء سريع', loop: 'تأخير الحلقة', ofCore: 'من نواة', limit: 'الحد',
      nowPlaying: 'يعمل الآن', nothingPlaying: 'لا يوجد تشغيل حاليا', nowPlayingCount: 'روم شغال الآن', warnings: 'تنبيهات تحتاج انتباهك',
      audioHealth: 'صحة الصوت', last30s: 'آخر 30 ثانية', ahCuts: 'تقطيع', ahLost: 'فاقد', ahWeb: 'مستمعين ويب', ahUnder: 'تقطيع عندهم', ahNone: 'ما فيه صوت شغال في الجسر الحين',
      unknownGuilds: 'سيرفرات غير مشتركة البوت موجود فيها',
      initialPw: 'كلمة مرور اللوحة الأولية ما زالت مستخدمة — غيّرها من صفحة الأمان', leave: 'إخراج البوت',
      search: 'بحث…', all: 'الكل', active: 'فعّال', expired: 'منتهي', none: 'بدون اشتراك', unknown: 'غير معروف',
      lifetime: 'مدى الحياة', daysLeft: 'متبقي {n} يوم', expiresOn: 'ينتهي {d}', members: 'عضو',
      tabMusic: 'الموسيقى', support: 'الدعم', supportSub: 'شكوى أو اقتراح أو مشكلة أو سؤال عن البوت. إدارة عود ترد عليك هنا وفي الخاص بديسكورد.', supportSubStaff: 'تذاكر الأعضاء والمشرفين. ردّك يوصل للشخص في الخاص بديسكورد.', newTicket: 'تذكرة جديدة', tKind: 'النوع', tk_complaint: 'شكوى', tk_suggestion: 'اقتراح', tk_problem: 'مشكلة', tk_question: 'سؤال', tServer: 'السيرفر (اختياري)', tNoServer: 'بدون سيرفر', tTitle: 'العنوان', tText: 'التفاصيل', tSent: 'انرسلت التذكرة', myTickets: 'تذاكري', allTickets: 'كل التذاكر', ts_open: 'مفتوحة', ts_answered: 'انرد عليها', ts_closed: 'مقفلة', tReply: 'ردّك', tClose: 'قفل التذكرة', tReopen: 'افتحها من جديد', tNone: 'ما فيه تذاكر', tStaff: 'إدارة عود', tNew: 'جديد', tClosedNote: 'التذكرة مقفلة. افتحها من جديد إذا تبي ترد.', tLimits: 'لا تكتب كلمات مرور أو توكنات.', tabAdminView: 'ما يشوفه المشرف', viewOnly: 'عرض بس — إدارة البوت قفلت التعديل هنا', avNothing: 'إدارة البوت ما فتحت لك أي قسم في هذا السيرفر.', avHint: 'هذا لمشرفين السيرفر (Manage Server). أنت والمدراء تشوفون كل شي دائماً. "الافتراضي" يمشي على كل السيرفرات، و"هذا السيرفر" يغلبه. المخفي يظل شغال بإعداداته، بس المشرف ما يشوفه ولا يغيّره (في الداشبورد ولوحة ديسكورد).', avDefault: 'الافتراضي (كل السيرفرات)', avPresets: 'قوالب جاهزة', avApplyTo: 'طبّق على', avPresetHint: 'القالب يعبّي الخيارات تحت، واضغط حفظ عشان يتطبق.', avPresetDone: 'تعبّت الخيارات — اضغط حفظ', avp_full: 'مشرف كامل', avp_music: 'أغاني بس', avp_view: 'عرض بس', avp_none: 'إخفاء الكل', avThis: 'هذا السيرفر', avNow: 'الحين', lvl_show: 'ظاهر', lvl_read: 'عرض بس', lvl_hide: 'مخفي', lvl_inherit: 'مثل الافتراضي', sec_music: 'الأغاني', sech_music: 'التحكم بالتشغيل والقائمة', sec_stats: 'الإحصائيات', sech_stats: 'تبويب الإحصائيات', sec_plan: 'الاشتراك', sech_plan: 'تاريخ الانتهاء وطلب التجديد', sec_rooms: 'تعيين الرومات', sech_rooms: 'رومات البوت الرئيسي وبوتات الغرف', sec_voice: 'صوت البوت الرئيسي', sech_voice: 'إيقاف واستئناف وإعادة اتصال', sec_roomBots: 'بوتات الغرف', sech_roomBots: 'إيقاف واستئناف وإعادة اتصال', sec_botEdit: 'تعديل البوتات', sech_botEdit: 'الاسم والصورة والحالة، وإضافة وحذف بوتات (لوحة ديسكورد)', sec_bridge: 'الربط (Bridge)', sech_bridge: 'المكسر والكتم والصوت وكتم الأشخاص', sec_guests: 'روابط الضيوف', sech_guests: 'إنشاء وحذف روابط الاستماع', sec_webListen: 'الاستماع من الويب', sech_webListen: 'زر "استمع"', sec_perms: 'الصلاحيات', sech_perms: 'DJ والحظر وإعدادات المستمعين والحدود', tabBridge: 'الجسر (Bridge)', mgrAll: 'كل السيرفرات', mgrScoped: '{n} سيرفر', mgrScopeEdit: 'حدد السيرفرات (بدون تحديد = كلها، والمحدد يصير مشرف سيرفر عليها بس)', personMute: 'اضغط عشان تكتمه في الجسر', personUnmute: 'مكتوم في الجسر — اضغط عشان ترجّع صوته', agTitle: 'سيرفر الإدارة', agHint: 'هنا يشتغل أمر اشتراكات ولوحة الاشتراكات، ورتب مشرفي الاشتراكات تنقرأ من هذا السيرفر.', agNone: 'ما فيه', agFromEnv: 'من ملف الإعدادات', tabSub: 'الاشتراك', tabPlan: 'الاشتراك', planActive: 'فعّال', planLifetime: 'دائم', planGrace: 'منتهي — مهلة', planEnded: 'منتهي', planYes: 'موجود', planNo: 'غير موجود', planEnds: 'ينتهي في', planDaysLeft: 'باقي {n} يوم', planRoomBots: 'بوتات الغرف', planGraceHint: 'الاشتراك انتهى. البوت باقي في السيرفر لين {d} — إذا تجدد قبلها يرجع كل شي بدون دعوة جديدة.', planRenewTitle: 'التجديد', planRenewHint: 'تبي تجدد أو تضيف مزايا؟ كلم إدارة عود.', planRenew: 'تواصل للتجديد', planRenewAsk: 'كلم إدارة عود للتجديد.', planAsk: 'اطلب تجديد', planAsked: 'انرسل طلبك لإدارة عود', tabRooms: 'الرومات', tabDanger: 'إجراءات',
      master: 'الرئيسي', slave: 'مساعد', queue: 'قائمة الانتظار', empty: 'فارغة', history: 'آخر ما تم تشغيله',
      addTrack: 'أضف أغنية أو رابط…', add: 'إضافة', addToQueue: 'أضف للقائمة', playNext: 'التالي', volume: 'الصوت', filter: 'المؤثر', loopMode: 'التكرار',
      loopNone: 'بدون', loopQueue: 'القائمة', loopTrack: 'الأغنية', autoDj: 'Auto DJ', clear: 'مسح', shuffle: 'خلط',
      playlists: 'قوائم التشغيل', load: 'تحميل', saveQueue: 'حفظ قائمة', plNamePh: 'اسم القائمة', plNameBad: 'اسم القائمة بين 1 و50 حرفاً', noPl: 'لا توجد قوائم',
      toTop: 'إلى بداية القائمة', adjSimilar: '✨ يشبه ما يعمل الآن', adjMood: 'مزاج/بحث', adjMoodPh: 'اكتب مزاجاً أو بحثاً ثم Enter',
      added: 'أضيفت للقائمة', showAll: 'عرض الكل', showLess: 'عرض أقل',
      play: 'تشغيل', pause: 'إيقاف مؤقت', resume: 'استئناف', skip: 'تخطي', stop: 'إيقاف', cantPlay: 'لا يمكن التحميل — البوت غير متصل بالروم الصوتي', notConnected: 'البوت غير متصل بالروم الصوتي',
      requestedBy: 'طلب', listeners: 'مستمع', bridgeOff: 'الجسر غير مفعّل لهذا السيرفر — فعّله من تبويب الاشتراك', roomEmpty: 'لا أحد في الروم',
      mute: 'كتم', unmute: 'إلغاء الكتم', solo: 'منفرد', soloOff: 'إلغاء المنفرد', enabled: 'مفعّل', disabled: 'معطّل',
      collision: 'نفس روم الرئيسي', live: 'نشط', silent: 'صامت', fps: 'إطار/ث',
      subActive: 'الاشتراك فعّال', subMusic: 'الموسيقى', subBridge: 'الجسر (Bridge)', subSlaves: 'البوتات المساعدة',
      subAutoRoom: 'إنشاء الرومات تلقائياً', subWebListen: 'الاستماع من الويب', subEditProfile: 'السماح بتعديل ملف البوتات', subLifetime: 'مدى الحياة', subLabelLock: 'تثبيت الاسم',
      maxSlaves: 'أقصى عدد بوتات مساعدة', label: 'الاسم', note: 'ملاحظة', expires: 'تاريخ الانتهاء', save: 'حفظ', extend: 'تمديد',
      addSub: 'تفعيل اشتراك لهذا السيرفر', removeSub: 'حذف الاشتراك', confirmType: 'اكتب {x} للتأكيد', cancel: 'إلغاء', confirm: 'تأكيد',
      voiceRoom: 'روم الصوت الرئيسي', textRoom: 'روم الكتابة', voiceCtl: 'التحكم بالصوت', pauseVoice: 'إيقاف البوت مؤقتاً', resumeVoice: 'تشغيل البوت', rejoin: 'إعادة الاتصال',
      leaveGuild: 'إخراج البوت من السيرفر', leaveWarn: 'البوت سيخرج من السيرفر، وسيحتاج دعوة جديدة للعودة.',
      master_bot: 'البوت الرئيسي', pool: 'مخزون البوتات', deployments: 'نشر في', guilds: 'سيرفر', invite: 'رابط الدعوة',
      level: 'المستوى', pauseLive: 'إيقاف البث', resumeLive: 'متابعة البث', copy: 'نسخ', copied: 'تم النسخ',
      target: 'المستلمون', tAll: 'كل السيرفرات', tActive: 'السيرفرات الفعّالة', bcTplPick: 'قالب محفوظ…', bcTplSave: 'احفظ كقالب', bcTplDel: 'احذف القالب', bcTplName: 'اسم القالب', bcAt: 'وقت الإرسال', bcSchedule: 'جدولة', bcAtNeed: 'اختر وقت الإرسال', bcScheduledOk: 'انجدول الإعلان', bcScheduled: 'إعلانات مجدولة', tActiveMaster: 'الفعّالة (البوت الرئيسي فقط)', tInactive: 'غير الفعّالة', tExpired: 'المنتهية', tOwners: 'ملاك السيرفرات (خاص)',
      message: 'الرسالة', preview: 'معاينة العدد', send: 'إرسال', recipients: '{n} مستلم', sent: 'تم الإرسال: {ok} نجاح، {fail} فشل',
      tOne: 'سيرفر واحد', bcServer: 'السيرفر', bcPickServer: 'اختر السيرفر', bcModeOne: 'رسالة واحدة لكل سيرفر', bcModeAll: 'كل رومات البوتات', bcMentions: 'تنبيه الكل: @everyone و @here والرتب', bcMentionsOff: 'مقفل: تظهر @everyone كنص بدون تنبيه', bcMentionsOn: 'مفعّل: يصل تنبيه لكل الأعضاء', bcMentionWarn: 'الرسالة فيها @everyone أو @here والتنبيه مقفل، فستظهر كنص فقط',
      bcMsgAr: 'الرسالة (عربي)', bcEn: 'نسخة إنجليزية', bcEnHint: 'السيرفرات المضبوطة على English تستلم هذه النسخة', bcMsgEn: 'الرسالة (English)', bcPreview: 'معاينة', bcRecipients: 'المستلمون', bcSum: '{s} سيرفر · {m} رسالة', bcSumOwners: '{m} مالك · {s} سيرفر', bcNone: 'لا يوجد مستلمون بهذا الاختيار', bcLoading: 'جارٍ حساب المستلمين…',
      bcSkip_no_channel: 'لا توجد قناة محددة للبوت', bcSkip_no_guild: 'البوت ليس في السيرفر', bcSkip_no_owner: 'المالك غير معروف', bcSumSkip: '{k} تم تخطيه', bcNotIn: 'البوت غير موجود', bcGuilds: '{n} سيرفرات', bcMain: 'البوت الرئيسي', bcConfirm: 'سيتم الإرسال إلى: {s}. متأكد؟', bcConfirmMention: 'التنبيه مفعّل: سيصل إشعار لكل الأعضاء.', bcBusy: 'يوجد إعلان آخر قيد الإرسال، انتظر حتى ينتهي', bcEmpty: 'اكتب الرسالة أولاً', bcTooLong: 'الرسالة أطول من 2000 حرف',
      bcHistory: 'الإعلانات السابقة', bcNoHistory: 'لا توجد إعلانات سابقة', bcRetry: 'إعادة الإرسال للفاشلة', bcRetried: 'أعيد الإرسال: {ok} نجاح، {fail} فشل', bcSkipped: 'تم تخطيه', bcBy: 'بواسطة', bcMentionPill: 'تنبيه الكل', bcLangAr: 'ع', bcLangEn: 'EN', bcTextEn: 'النسخة الإنجليزية',
      bcr_no_channel: 'القناة غير موجودة', bcr_no_guild: 'البوت ليس في السيرفر', bcr_no_owner: 'المالك غير معروف', bcr_no_perm: 'لا يملك البوت صلاحية الكتابة في القناة', bcr_no_access: 'لا يرى البوت القناة', bcr_dm_closed: 'الرسائل الخاصة مغلقة عند المالك', bcr_dm_failed: 'لم تصل الرسالة الخاصة', bcr_send_failed: 'فشل الإرسال', bcChars: '{n} / 2000',
      password: 'كلمة المرور', newPassword: 'كلمة مرور جديدة', changePw: 'تغيير كلمة المرور', pwRule: '10 أحرف على الأقل، حروف وأرقام',
      sessions: 'الجلسات النشطة', revokeAll: 'تسجيل خروج كل الأجهزة الأخرى', devices: 'أجهزة', dev1: 'جهاز واحد', dev2: 'جهازين', devN: '{n} أجهزة', devMany: '{n} جهاز', justNow: 'الآن', you: 'أنت', unknownUser: 'مستخدم غير معروف', thisDevice: 'هذا الجهاز', admins: 'مشرفو الاشتراكات', addAdmin: 'إضافة مشرف (Discord ID)', managers: 'المدراء', addManager: 'إضافة مدير (Discord ID)', mgrHint: 'المدير يدير كل السيرفرات والاشتراكات والإعلانات والبوتات والسجلات والنسخ، ويشوف سجل العمليات بدون IP. ما يشوف كلمة المرور والجلسات والمدراء.', owners: 'الملّاك (Owner)', addOwner: 'إضافة Owner (Discord ID)', ownerHint: 'نفس صلاحياتك كاملة، إلا إضافة وحذف الملّاك وتغيير كلمة المرور وتسجيل خروجك.',
      restore: 'ترجيع', restoreHint: 'يرجّع الملفات المختارة من هذا اليوم ويعيد تشغيل البوت (دقيقة تقريباً). نسخة من الملفات الحالية تنحفظ قبل الترجيع. ملفات الدخول والتوكنات ما ترجع من هنا.', restoreNone: 'ما فيه ملفات تنرجع', restoreStarted: 'جاري الترجيع — البوت يعيد التشغيل الحين', restorePending: 'ترجيع نسخة {d} ينتظر إعادة التشغيل', restoreLast: 'آخر ترجيع: نسخة {d} ({n} ملف) {at}', backups: 'النسخ الاحتياطية اليومية', backupNow: 'نسخة الآن', auditLog: 'سجل عمليات اللوحة', files: 'ملف',
      loginTitle: 'تسجيل الدخول', loginDiscord: 'الدخول عبر Discord', loginDiscordHint: 'اكتب كلمة dashboard في أي روم كتابة بسيرفر مشترك، ويوصلك رابط دخول في الخاص.',
      orId: 'أو اطلب الرابط بمعرّفك', yourId: 'Discord User ID', searchMember: 'ابحث عن عضو بالاسم أو الآيدي', sendLink: 'أرسل الرابط', linkSent: 'إذا كان حسابك مصرّح له، وصلك رابط في الخاص.',
      orPassword: 'أو بكلمة المرور', login: 'دخول', wrongPw: 'كلمة المرور غير صحيحة', expiredLink: 'الرابط منتهي أو مستخدم. اطلب رابط جديد.',
      saved: 'تم الحفظ', done: 'تم', failed: 'فشل', loading: 'جارٍ التحميل…', palette: 'انتقال سريع', theme: 'المظهر', lang: 'English',
      ago: 'قبل {x}', sec: 'ث', min: 'د', hr: 'س', day: 'ي', never: '—', notInGuild: 'البوت ليس في هذا السيرفر', noAccess: 'لا تملك صلاحية',
      bootMaster: 'الرئيسي جاهز', bootSlaves: 'المساعدون جاهزون', ytSearch: 'نتائج البحث', when: 'الوقت', auditMore: 'عرض المزيد', aud_sub: 'الاشتراكات', aud_auth: 'الدخول والمشرفين', aud_music: 'الموسيقى', aud_other: 'أخرى', aud_subscription_extend: 'تمديد اشتراك', aud_subscription_set: 'تعديل اشتراك', aud_subscription_remove: 'حذف اشتراك', aud_auth_login: 'تسجيل دخول', aud_auth_revoke: 'تسجيل خروج جهاز', aud_auth_revokeAll: 'تسجيل خروج الكل', aud_auth_role_changed: 'تغيّرت الصلاحية', aud_guild_perms: 'تعديل الصلاحيات', aud_admin_add: 'إضافة مشرف', aud_admin_remove: 'حذف مشرف', who: 'المستخدم', action: 'العملية',
      rooms: 'الرومات', channel: 'الروم', status: 'الحالة', open: 'فتح', health: 'صحة السيرفر', last1h: 'آخر ساعة',
      tabStats: 'الإحصائيات', plays: 'تشغيلات', hoursPlayed: 'ساعات استماع', today: 'اليوم', last30: 'آخر 30 يوم', topTracks: 'الأكثر تشغيلاً',
      topDjs: 'أكثر من يطلب', byHour: 'النشاط حسب الساعة (UTC)', noStats: 'لا توجد إحصائيات بعد — تبدأ مع أول أغنية', alertsTitle: 'تنبيهات المراقبة', since: 'منذ',
      player: 'المشغل', roomOwnerLbl: 'صاحب الروم', allControls: 'كل التحكم', lessControls: 'إخفاء التحكم', nowWatching: 'تشاهد', recentActivity: 'آخر العمل', recentSongs: 'آخر الأغاني', recentActions: 'آخر الإجراءات', otherBots: 'البوتات الثانية', idleBot: 'فاضي', todayPlays: 'تشغيلات اليوم', totalPlays: 'كل التشغيلات', topSongs: 'أكثر الأغاني', topRequesters: 'أكثر الطالبين', noActivity: 'ما فيه نشاط للحين', act_play: 'أضاف أغنية', act_skip: 'تخطّى', act_voteskip: 'صوّت للتخطي', act_pause: 'وقّف مؤقت', act_resume: 'كمّل', act_stop: 'أوقف', act_volume: 'غيّر الصوت', act_shuffle: 'خلط', act_loop: 'التكرار', act_filter: 'فلتر', act_remove: 'حذف أغنية', act_move: 'رتّب', act_moveto: 'رتّب', act_jump: 'قفز لأغنية', act_clear: 'مسح القائمة', act_autodj: 'Auto DJ', act_seek: 'قدّم/رجّع', now: 'الآن', nowIn: 'أنت في', nowNoBot: 'أنت في روم ما فيه البوت', nowElsewhere: 'شغال في سيرفراتك الثانية', myServers: 'سيرفراتي', srvSettings: 'إعدادات السيرفر', upNext: 'التالي', fullControl: 'تحكم كامل', voteSkip: 'تصويت للتخطي', memberNoGuilds: 'البوت مو موجود بأي سيرفر أنت فيه', memberJoinHint: 'ادخل روم البوت الصوتي في Discord عشان تتحكم بالأغاني',
      lvl_viewer: 'مشاهد', lvl_listener: 'مستمع', lvl_roomOwner: 'صاحب الروم', lvl_dj: 'DJ', lvl_admin: 'مشرف',
      permsTab: 'الصلاحيات', lvl_banned: 'محظور', manageServer: 'إدارة السيرفر', inVoiceRoom: 'في روم صوت البوت', djRoleHint: 'إذا ما اخترت شي، أي رتبة اسمها DJ تنحسب',
      listenersCard: 'المستمعون', blockedUsers: 'المستخدمون المحظورون', permTest: 'فحص صلاحية', djUsers: 'حسابات DJ', idBad: 'معرف غير صالح (17-20 رقمًا)',
      lvlD_admin: 'كل شي + إعدادات السيرفر', lvlD_dj: 'تحكم كامل بالموسيقى ومنها الإيقاف', lvlD_roomOwner: 'تحكم كامل بالروم حقه ما عدا الإيقاف', lvlD_listener: 'داخل روم البوت: يضيف، يصوّت للتخطي، إيقاف مؤقت، الصوت (حسب الإعدادات تحت)', lvlD_viewer: 'مو بالروم: يشوف وش شغال بس', lvlD_banned: 'ممنوع من أي تحكم',
      listenerCanAdd: 'المستمع يضيف أغاني', listenerVoteSkip: 'المستمع يصوّت للتخطي', allowLinks: 'السماح بالروابط',
      playPerMin: 'عدد الأغاني بالدقيقة لكل عضو', maxTrackMin: 'أقصى طول للأغنية بالدقائق (0 = بدون حد)',
      listenerCanPause: 'المستمع يوقف ويكمل', listenerCanVolume: 'المستمع يغير الصوت', pauseWhenEmpty: 'وقف الأغنية إذا الروم فاضي دقيقتين', djOnly: 'التحكم للـ DJ بس', djOnlyHint: 'إذا تفعّل: المستمعين وصاحب الروم يشوفون بس، والتحكم للـ DJ ومشرفين السيرفر.', maxQueuedPerMember: 'أغاني العضو في القائمة (0 = بدون حد)', listenerMaxVolume: 'أعلى صوت للمستمعين (10-200)',
      listen: 'استمع', listenStop: 'إيقاف الاستماع', listenUnsupported: 'متصفحك ما يدعم الاستماع — حدّثه أو جرّب Chrome', listenFailed: 'تعذّر الاستماع للروم', webListeners: 'يستمعون من الويب', listenAll: 'كل الرومات', listenMain: 'الروم الرئيسي', listenRoom: 'اختر الروم', guestLinks: 'روابط استماع للضيوف', guestHint: 'رابط يفتحه أي أحد ويستمع بدون تسجيل دخول، لوقت محدد. تقدر تلغيه متى ما بغيت.', guestLabel: 'اسم للرابط (اختياري)', guestCreate: 'إنشاء رابط', guestCopyNow: 'انسخ الرابط الحين — ما يظهر مرة ثانية', guestCopy: 'نسخ', guestRevoke: 'إلغاء', guestRevokeQ: 'يوقف الرابط ويقطع اللي يستمعون فيه الحين.', guestUntil: 'ينتهي', guestNoLabel: 'رابط بدون اسم', guestNone: 'ما فيه روابط شغالة', gh1: 'ساعة', gh6: '6 ساعات', gh24: 'يوم', gh168: 'أسبوع', listenReconnecting: 'يعيد الاتصال…', listenVol: 'مستوى الأصوات', listenMusic: 'البوت (الأغاني)', listenReset: 'إرجاع', listenNoMembers: 'ما فيه أحد في الروم', listenErr_login: 'سجّل دخولك من جديد', listenErr_forbidden: 'ما عندك صلاحية على هذا السيرفر', listenErr_off: 'الاستماع من الويب مقفل — فعّله من تبويب الاشتراك', listenErr_noguild: 'البوت مو في هذا السيرفر', listenErr_busy: 'وصلت الحد الأعلى للمستمعين — سكّر استماع ثاني', listenErr_room: 'هذا الروم ما فيه بوت الحين',
    },
    en: {
      appName: 'Oud Dashboard', tagline: 'Full bot control',
      overview: 'Overview', servers: 'Servers', music: 'Live music', bots: 'Bots', logs: 'Logs',
      broadcast: 'Broadcast', security: 'Security & backups', more: 'More', logout: 'Log out', owner: 'Owner', guildMgr: 'Server manager', roleOwner: 'Owner', roleManager: 'Manager', roleAdmin: 'Admin', roleSubs: 'Subscriptions admin', roleMember: 'Member',
      online: 'Online', offline: 'Offline', ping: 'Ping', uptime: 'Uptime', boot: 'Boot time',
      subscribed: 'Subscribed servers', streams: 'Live streams', voice: 'Voice connections', slaves: 'Helper bots', errors: 'Errors (1h)',
      cpu: 'CPU', ram: 'Memory', pids: 'Processes', warmStarts: 'warm starts', loop: 'Event loop', ofCore: 'of a core', limit: 'limit',
      nowPlaying: 'Now playing', nothingPlaying: 'Nothing is playing right now', nowPlayingCount: 'rooms playing now', warnings: 'Needs your attention',
      audioHealth: 'Audio health', last30s: 'last 30 s', ahCuts: 'cuts', ahLost: 'lost', ahWeb: 'web listeners', ahUnder: 'their gaps', ahNone: 'No bridge audio right now',
      unknownGuilds: 'Unsubscribed servers the bot is in',
      initialPw: 'The initial dashboard password is still in use — change it in Security', leave: 'Remove bot',
      search: 'Search…', all: 'All', active: 'Active', expired: 'Expired', none: 'No subscription', unknown: 'Unknown',
      lifetime: 'Lifetime', daysLeft: '{n} days left', expiresOn: 'Expires {d}', members: 'members',
      tabMusic: 'Music', support: 'Support', supportSub: 'A complaint, suggestion, problem or question about the bot. The Oud team answers here and in your Discord DMs.', supportSubStaff: 'Tickets from members and admins. Your reply reaches the person by Discord DM.', newTicket: 'New ticket', tKind: 'Type', tk_complaint: 'Complaint', tk_suggestion: 'Suggestion', tk_problem: 'Problem', tk_question: 'Question', tServer: 'Server (optional)', tNoServer: 'No server', tTitle: 'Title', tText: 'Details', tSent: 'Ticket sent', myTickets: 'My tickets', allTickets: 'All tickets', ts_open: 'Open', ts_answered: 'Answered', ts_closed: 'Closed', tReply: 'Your reply', tClose: 'Close ticket', tReopen: 'Reopen', tNone: 'No tickets', tStaff: 'Oud team', tNew: 'new', tClosedNote: 'This ticket is closed. Reopen it to reply.', tLimits: 'Never write passwords or tokens.', tabAdminView: 'What admins see', viewOnly: 'View only — changes are locked by the bot management', avNothing: 'The bot management has not opened any section on this server for you.', avHint: 'For server admins (Manage Server). You and managers always see everything. "Default" applies to every server; "This server" overrides it. A hidden section keeps working with its settings, but admins cannot see or change it (dashboard and Discord panel).', avDefault: 'Default (all servers)', avPresets: 'Presets', avApplyTo: 'Apply to', avPresetHint: 'A preset fills the choices below; press Save to apply.', avPresetDone: 'Filled — press Save', avp_full: 'Full admin', avp_music: 'Music only', avp_view: 'View only', avp_none: 'Hide all', avThis: 'This server', avNow: 'Now', lvl_show: 'Shown', lvl_read: 'View only', lvl_hide: 'Hidden', lvl_inherit: 'Same as default', sec_music: 'Music', sech_music: 'Playback and queue controls', sec_stats: 'Statistics', sech_stats: 'Statistics tab', sec_plan: 'Plan', sech_plan: 'End date and renewal request', sec_rooms: 'Room assignment', sech_rooms: 'Main bot and room bot rooms', sec_voice: 'Main bot voice', sech_voice: 'Pause, resume, reconnect', sec_roomBots: 'Room bots', sech_roomBots: 'Pause, resume, reconnect', sec_botEdit: 'Bot editing', sech_botEdit: 'Name, avatar, status; add / remove bots (Discord panel)', sec_bridge: 'Bridge', sech_bridge: 'Mixer, mute, volume, person mute', sec_guests: 'Guest links', sech_guests: 'Create and revoke listening links', sec_webListen: 'Web listening', sech_webListen: 'The "Listen" button', sec_perms: 'Permissions', sech_perms: 'DJ, bans, listener settings, limits', tabBridge: 'Bridge', mgrAll: 'All servers', mgrScoped: '{n} server(s)', mgrScopeEdit: 'Limit to servers (none = all; limited = server admin on those only)', personMute: 'Tap to mute on the bridge', personUnmute: 'Muted on the bridge — tap to unmute', agTitle: 'Admin server', agHint: 'The subs command and panel work here, and subscription admin roles are read from this server.', agNone: 'None', agFromEnv: 'from the settings file', tabSub: 'Subscription', tabPlan: 'Plan', planActive: 'Active', planLifetime: 'Lifetime', planGrace: 'Ended — grace period', planEnded: 'Ended', planYes: 'Included', planNo: 'Not included', planEnds: 'Ends on', planDaysLeft: '{n} days left', planRoomBots: 'Room bots', planGraceHint: 'The plan has ended. The bot stays in the server until {d} — renew before then and everything comes back, no new invite needed.', planRenewTitle: 'Renewal', planRenewHint: 'Want to renew or add features? Contact the Oud team.', planRenew: 'Contact to renew', planRenewAsk: 'Contact the Oud team to renew.', planAsk: 'Ask for renewal', planAsked: 'Your request was sent to the Oud team', tabRooms: 'Rooms', tabDanger: 'Actions',
      master: 'Main', slave: 'Helper', queue: 'Queue', empty: 'empty', history: 'Recently played',
      addTrack: 'Add a song or link…', add: 'Add', addToQueue: 'Add to queue', playNext: 'Next', volume: 'Volume', filter: 'Effect', loopMode: 'Loop',
      loopNone: 'Off', loopQueue: 'Queue', loopTrack: 'Track', autoDj: 'Auto DJ', clear: 'Clear', shuffle: 'Shuffle',
      playlists: 'Playlists', load: 'Load', saveQueue: 'Save queue', plNamePh: 'Playlist name', plNameBad: 'Playlist name must be 1-50 characters', noPl: 'No saved playlists',
      toTop: 'Move to top', adjSimilar: '✨ Similar to what\'s playing', adjMood: 'Mood / search', adjMoodPh: 'Type a mood or search, then Enter',
      added: 'Added to queue', showAll: 'Show all', showLess: 'Show less',
      play: 'Play', pause: 'Pause', resume: 'Resume', skip: 'Skip', stop: 'Stop', cantPlay: 'Can\'t load — bot is not connected to the voice room', notConnected: 'Bot is not connected to the voice room',
      requestedBy: 'by', listeners: 'listeners', bridgeOff: 'Bridge is off for this server — enable it in Subscription', roomEmpty: 'Nobody in the room',
      mute: 'Mute', unmute: 'Unmute', solo: 'Solo', soloOff: 'Clear solo', enabled: 'Enabled', disabled: 'Disabled',
      collision: 'Same room as main', live: 'Live', silent: 'Silent', fps: 'fps',
      subActive: 'Subscription active', subMusic: 'Music', subBridge: 'Bridge', subSlaves: 'Helper bots',
      subAutoRoom: 'Auto-create rooms', subWebListen: 'Web listening', subEditProfile: 'Allow bot profile edits', subLifetime: 'Lifetime', subLabelLock: 'Lock name',
      maxSlaves: 'Max helper bots', label: 'Name', note: 'Note', expires: 'Expiry date', save: 'Save', extend: 'Extend',
      addSub: 'Activate a subscription for this server', removeSub: 'Delete subscription', confirmType: 'Type {x} to confirm', cancel: 'Cancel', confirm: 'Confirm',
      voiceRoom: 'Main voice room', textRoom: 'Text room', voiceCtl: 'Voice control', pauseVoice: 'Pause bot', resumeVoice: 'Resume bot', rejoin: 'Reconnect',
      leaveGuild: 'Remove bot from server', leaveWarn: 'The bot will leave this server and needs a new invite to come back.',
      master_bot: 'Main bot', pool: 'Bot pool', deployments: 'Deployed in', guilds: 'servers', invite: 'Invite link',
      level: 'Level', pauseLive: 'Pause live', resumeLive: 'Resume live', copy: 'Copy', copied: 'Copied',
      target: 'Recipients', tAll: 'All servers', tActive: 'Active servers', bcTplPick: 'Saved template…', bcTplSave: 'Save as template', bcTplDel: 'Delete template', bcTplName: 'Template name', bcAt: 'Send time', bcSchedule: 'Schedule', bcAtNeed: 'Pick a send time', bcScheduledOk: 'Broadcast scheduled', bcScheduled: 'Scheduled broadcasts', tActiveMaster: 'Active (main bot only)', tInactive: 'Inactive', tExpired: 'Expired', tOwners: 'Server owners (DM)',
      message: 'Message', preview: 'Count recipients', send: 'Send', recipients: '{n} recipients', sent: 'Sent: {ok} ok, {fail} failed',
      tOne: 'One server', bcServer: 'Server', bcPickServer: 'Pick the server', bcModeOne: 'One message per server', bcModeAll: 'Every bot channel', bcMentions: 'Notify everyone (@everyone, @here, roles)', bcMentionsOff: 'Off: @everyone shows as text, no ping', bcMentionsOn: 'On: every member gets a ping', bcMentionWarn: 'The message has @everyone or @here but notify is off, so it shows as text only',
      bcMsgAr: 'Message (Arabic)', bcEn: 'English version', bcEnHint: 'Servers set to English receive this version', bcMsgEn: 'Message (English)', bcPreview: 'Preview', bcRecipients: 'Recipients', bcSum: '{s} servers · {m} messages', bcSumOwners: '{m} owners · {s} servers', bcNone: 'Nobody receives it with this choice', bcLoading: 'Counting recipients…',
      bcSkip_no_channel: 'No bot channel set', bcSkip_no_guild: 'Bot is not in the server', bcSkip_no_owner: 'Owner unknown', bcSumSkip: '{k} skipped', bcNotIn: 'bot not in server', bcGuilds: '{n} servers', bcMain: 'main bot', bcConfirm: 'Sending to: {s}. Sure?', bcConfirmMention: 'Notify is on: every member gets a ping.', bcBusy: 'Another broadcast is being sent, wait until it finishes', bcEmpty: 'Write the message first', bcTooLong: 'The message is longer than 2000 characters',
      bcHistory: 'Past broadcasts', bcNoHistory: 'No broadcasts yet', bcRetry: 'Resend to failed', bcRetried: 'Resent: {ok} ok, {fail} failed', bcSkipped: 'skipped', bcBy: 'by', bcMentionPill: 'notify all', bcLangAr: 'ع', bcLangEn: 'EN', bcTextEn: 'English version',
      bcr_no_channel: 'Channel not found', bcr_no_guild: 'Bot is not in the server', bcr_no_owner: 'Owner unknown', bcr_no_perm: 'Bot cannot write in the channel', bcr_no_access: 'Bot cannot see the channel', bcr_dm_closed: 'Owner has DMs closed', bcr_dm_failed: 'DM not delivered', bcr_send_failed: 'Send failed', bcChars: '{n} / 2000',
      password: 'Password', newPassword: 'New password', changePw: 'Change password', pwRule: '10+ characters, letters and digits',
      sessions: 'Active sessions', revokeAll: 'Log out all other devices', devices: 'devices', dev1: '1 device', dev2: '2 devices', devN: '{n} devices', devMany: '{n} devices', justNow: 'just now', you: 'you', unknownUser: 'Unknown user', thisDevice: 'this device', admins: 'Subscription admins', addAdmin: 'Add admin (Discord ID)', managers: 'Managers', addManager: 'Add manager (Discord ID)', mgrHint: 'Managers run every server, subscriptions, broadcasts, bots, logs and backups, and read the audit log without IPs. They do not see the password, sessions or managers.', owners: 'Owners', addOwner: 'Add owner (Discord ID)', ownerHint: 'All your powers, except adding / removing owners, the password, and logging you out.',
      restore: 'Restore', restoreHint: 'Puts the chosen files back from this day and restarts the bot (about a minute). The current files are saved first. Login and token files are never restored from here.', restoreNone: 'Nothing to restore', restoreStarted: 'Restoring — the bot is restarting now', restorePending: 'Restore of {d} waits for the restart', restoreLast: 'Last restore: {d} ({n} files) {at}', backups: 'Daily backups', backupNow: 'Back up now', auditLog: 'Dashboard audit log', files: 'files',
      loginTitle: 'Sign in', loginDiscord: 'Sign in with Discord', loginDiscordHint: 'Type dashboard in any text channel of a subscribed server and the bot DMs you a login link.',
      orId: 'or request the link with your ID', yourId: 'Discord User ID', searchMember: 'Search member by name or ID', sendLink: 'Send link', linkSent: 'If your account is allowed, a link was sent by DM.',
      orPassword: 'or with the password', login: 'Sign in', wrongPw: 'Wrong password', expiredLink: 'Link expired or already used. Request a new one.',
      saved: 'Saved', done: 'Done', failed: 'Failed', loading: 'Loading…', palette: 'Quick jump', theme: 'Theme', lang: 'العربية',
      ago: '{x} ago', sec: 's', min: 'm', hr: 'h', day: 'd', never: '—', notInGuild: 'Bot is not in this server', noAccess: 'No access',
      bootMaster: 'Main ready', bootSlaves: 'Helpers ready', ytSearch: 'Search results', when: 'When', auditMore: 'Show more', aud_sub: 'Subscriptions', aud_auth: 'Logins & admins', aud_music: 'Music', aud_other: 'Other', aud_subscription_extend: 'Subscription extended', aud_subscription_set: 'Subscription changed', aud_subscription_remove: 'Subscription removed', aud_auth_login: 'Signed in', aud_auth_revoke: 'Session revoked', aud_auth_revokeAll: 'All sessions revoked', aud_auth_role_changed: 'Role changed', aud_guild_perms: 'Permissions changed', aud_admin_add: 'Admin added', aud_admin_remove: 'Admin removed', who: 'User', action: 'Action',
      rooms: 'Rooms', channel: 'Channel', status: 'Status', open: 'Open', health: 'Server health', last1h: 'last hour',
      tabStats: 'Stats', plays: 'plays', hoursPlayed: 'hours listened', today: 'Today', last30: 'Last 30 days', topTracks: 'Most played',
      topDjs: 'Top requesters', byHour: 'Activity by hour (UTC)', noStats: 'No stats yet — they start with the first song', alertsTitle: 'Monitor alerts', since: 'since',
      player: 'Player', roomOwnerLbl: 'Room owner', allControls: 'All controls', lessControls: 'Hide controls', nowWatching: 'Watching', recentActivity: 'Recent activity', recentSongs: 'Recent songs', recentActions: 'Recent actions', otherBots: 'Other bots', idleBot: 'Idle', todayPlays: 'Plays today', totalPlays: 'All plays', topSongs: 'Top songs', topRequesters: 'Top requesters', noActivity: 'No activity yet', act_play: 'added a song', act_skip: 'skipped', act_voteskip: 'voted to skip', act_pause: 'paused', act_resume: 'resumed', act_stop: 'stopped', act_volume: 'changed volume', act_shuffle: 'shuffled', act_loop: 'loop', act_filter: 'filter', act_remove: 'removed a song', act_move: 'reordered', act_moveto: 'reordered', act_jump: 'jumped to a song', act_clear: 'cleared the queue', act_autodj: 'Auto DJ', act_seek: 'seeked', now: 'Now', nowIn: 'You are in', nowNoBot: 'You are in a voice room without the bot', nowElsewhere: 'Playing in your other servers', myServers: 'My servers', srvSettings: 'Server settings', upNext: 'Up next', fullControl: 'Full control', voteSkip: 'Vote skip', memberNoGuilds: 'The bot is not in any of your servers', memberJoinHint: "Join the bot's voice room in Discord to control the music",
      lvl_viewer: 'Viewer', lvl_listener: 'Listener', lvl_roomOwner: 'Room owner', lvl_dj: 'DJ', lvl_admin: 'Admin',
      permsTab: 'Permissions', lvl_banned: 'Blocked', manageServer: 'Manage Server', inVoiceRoom: "in the bot's voice room", djRoleHint: 'If none selected, a role named DJ counts',
      listenersCard: 'Listeners', blockedUsers: 'Blocked users', permTest: 'Test permission', djUsers: 'DJ accounts', idBad: 'Bad ID (17-20 digits)',
      lvlD_admin: 'Everything, plus server settings', lvlD_dj: 'Full music control, including stop', lvlD_roomOwner: 'Full control of their room except stop', lvlD_listener: "In the bot's room: add, vote skip, pause, volume (per settings below)", lvlD_viewer: "Not in the room: sees what's playing only", lvlD_banned: 'No music control at all',
      listenerCanAdd: 'Listeners can add songs', listenerVoteSkip: 'Listeners can vote skip', allowLinks: 'Allow links',
      playPerMin: 'Songs per minute per member', maxTrackMin: 'Max song length (min, 0 = no limit)',
      listenerCanPause: 'Listeners can pause/resume', listenerCanVolume: 'Listeners can change volume', pauseWhenEmpty: 'Pause when the room is empty for 2 min', djOnly: 'DJ only', djOnlyHint: 'When on: listeners and room owners only watch; DJs and server admins control the music.', maxQueuedPerMember: 'Songs per member in the queue (0 = no limit)', listenerMaxVolume: 'Highest volume for listeners (10-200)',
      listen: 'Listen', listenStop: 'Stop listening', listenUnsupported: 'Your browser cannot play this — update it or try Chrome', listenFailed: 'Could not listen to the room', webListeners: 'listening on the web', listenAll: 'All rooms', listenMain: 'Main room', listenRoom: 'Choose room', guestLinks: 'Guest listen links', guestHint: 'Anyone with the link can listen without logging in, for a limited time. You can cancel it any time.', guestLabel: 'Link name (optional)', guestCreate: 'Create link', guestCopyNow: 'Copy the link now — it will not be shown again', guestCopy: 'Copy', guestRevoke: 'Cancel link', guestRevokeQ: 'Stops the link and disconnects anyone listening with it now.', guestUntil: 'Ends', guestNoLabel: 'Unnamed link', guestNone: 'No active links', gh1: '1 hour', gh6: '6 hours', gh24: '1 day', gh168: '1 week', listenReconnecting: 'Reconnecting…', listenVol: 'Volumes', listenMusic: 'Bot (music)', listenReset: 'Reset', listenNoMembers: 'Nobody in the room', listenErr_login: 'Log in again', listenErr_forbidden: 'You have no access to this server', listenErr_off: 'Web listening is off — turn it on in the Subscription tab', listenErr_noguild: 'The bot is not in this server', listenErr_busy: 'Listener limit reached — close another stream', listenErr_room: 'No bot in this room right now',
    }
  };
  let lang = document.documentElement.lang === 'en' ? 'en' : 'ar';
  const t = (k, v = {}) => String(L[lang][k] ?? L.en[k] ?? k).replace(/\{(\w+)\}/g, (_, x) => (v[x] ?? ''));

  // ---------------------------------------------------------------- utils
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k, d = null) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  };
  const fmtDur = (s) => {
    s = Math.max(0, Math.floor(s || 0));
    const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const x = s % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
  };
  const fmtUptime = (s) => {
    const d = Math.floor(s / 86400); const h = Math.floor((s % 86400) / 3600); const m = Math.floor((s % 3600) / 60);
    return d ? `${d}${t('day')} ${h}${t('hr')}` : h ? `${h}${t('hr')} ${m}${t('min')}` : `${m}${t('min')}`;
  };
  const ago = (ts) => {
    if (!ts) return t('never');
    const s = Math.max(0, (Date.now() - ts) / 1000);
    if (s < 60) return t('justNow');
    const x = s < 60 ? `${Math.floor(s)}${t('sec')}` : s < 3600 ? `${Math.floor(s / 60)}${t('min')}` : s < 86400 ? `${Math.floor(s / 3600)}${t('hr')}` : `${Math.floor(s / 86400)}${t('day')}`;
    return t('ago', { x });
  };
  const fmtBytes = (b) => {
    if (b == null) return '—';
    const u = ['B', 'KB', 'MB', 'GB']; let i = 0;
    while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
    return `${b.toFixed(i >= 2 ? 1 : 0)} ${u[i]}`;
  };
  const dateStr = (iso) => { try { return new Date(iso).toLocaleDateString(lang === 'ar' ? 'ar-SA-u-ca-gregory' : 'en-GB', { year: 'numeric', month: 'short', day: 'numeric' }); } catch { return iso; } };
  const initials = (name) => esc(String(name || '?').trim().slice(0, 1).toUpperCase());

  // ---------------------------------------------------------------- icons
  const P = {
    home: 'M3 10.5L12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
    server: 'M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01',
    music: 'M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
    bot: 'M12 8V4H8M4 12h16v8H4zM2 14v4M22 14v4M9 16h.01M15 16h.01M6 12V9a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v3',
    log: 'M4 6h16M4 12h16M4 18h10',
    menu: 'M4 6h16M4 12h16M4 18h16',
    now: 'M3 18v-6a9 9 0 0 1 18 0v6M21 19a2 2 0 0 1-2 2h-1v-6h3zM3 19a2 2 0 0 0 2 2h1v-6H3z',
    gear: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
    mega: 'M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1zM16 8a5 5 0 0 1 0 8M19 5a9 9 0 0 1 0 14',
    shield: 'M12 3l8 3v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V6z',
    play: 'M7 4l13 8-13 8z', pause: 'M7 4h4v16H7zM13 4h4v16h-4z', skip: 'M5 4l10 8-10 8zM17 4h2v16h-2z', stop: 'M6 6h12v12H6z',
    shuffle: 'M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5', repeat: 'M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3',
    vol: 'M11 5L6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14', search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
    x: 'M18 6L6 18M6 6l12 12', up: 'M18 15l-6-6-6 6', down: 'M6 9l6 6 6-6', trash: 'M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14',
    refresh: 'M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5', sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
    moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z', globe: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20',
    out: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9', plus: 'M12 5v14M5 12h14', mic: 'M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v3',
    alert: 'M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01', check: 'M20 6L9 17l-5-5',
    clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2', ext: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3',
    cpu: 'M6 6h12v12H6zM9 9h6v6H9zM9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3', bolt: 'M13 2L3 14h9l-1 8 10-12h-9z',
    key: 'M21 2l-2 2m-7.6 7.6a5.5 5.5 0 1 1-7.8 7.8 5.5 5.5 0 0 1 7.8-7.8zM15.5 7.5l3 3L22 7l-3-3', copy: 'M9 9h11v11H9zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1',
    layers: 'M12 2l10 5-10 5L2 7zM2 17l10 5 10-5M2 12l10 5 10-5', wave: 'M2 12h2l3-7 4 14 4-10 3 6h4',
    chat: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  };
  const ic = (n, cls = '') => `<svg class="${cls}" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${P[n] || ''}"/></svg>`;
  const logo = () => '<svg width="34" height="34" viewBox="0 0 64 64"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f6cf8f"/><stop offset="1" stop-color="#c9822f"/></linearGradient></defs><rect width="64" height="64" rx="16" fill="#1b1713"/><path d="M27 49c-8.5 0-14-5.6-14-12.3 0-7.8 6.6-14.5 14.6-16.6l12.6-9.3 3.6 4.7-9.8 10.4c4.6 2.6 7.6 6.8 7.6 11.4C41.6 44 35.5 49 27 49z" fill="url(#lg)"/><circle cx="26.4" cy="36.6" r="4.2" fill="#1b1713"/><path d="M40.2 10.8l4.5-3.3 2.9 3.8-3.8 4.2z" fill="#f6cf8f"/><path d="M47 30c3 2 4.6 5 4.6 8.4M50.5 26.5c4.4 3 6.8 7.4 6.8 12.2" stroke="#e3a857" stroke-width="2.2" stroke-linecap="round" fill="none" opacity=".8"/></svg>';

  // ---------------------------------------------------------------- state
  const S = {
    me: null, csrf: null, data: {}, queues: new Map(), metrics: [], logs: [], logsPaused: false,
    route: { page: 'overview', params: {} }, es: null, refreshTimer: null, guildTab: store.get('oud.guildTab', 'music'), nowAll: store.get('oud.nowAll', '0') === '1', nowQAll: false,
    guildFilter: 'all', guildSearch: '', logLevel: '', logQuery: '',
    drag: null, plCache: new Map(), umOpen: false, sessOpen: null,
  };
  const isOwner = () => S.me?.role === 'owner';
  const isStaff = () => isOwner() || S.me?.role === 'manager'; // T57: owner or manager

  // ---------------------------------------------------------------- api
  async function api(method, url, body) {
    const opts = { method, headers: { Accept: 'application/json' }, credentials: 'same-origin' };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    if (method !== 'GET' && S.csrf) opts.headers['X-Oud-CSRF'] = S.csrf;
    const res = await fetch(url, opts);
    let data = null;
    try { data = await res.json(); } catch { /* empty */ }
    if (res.status === 401 && !url.startsWith('/api/auth/')) {
      S.me = null;
      go('#/login');
      throw new Error(t('loginTitle'));
    }
    if (!res.ok) throw new Error(data?.error || `${res.status}`);
    return data;
  }
  const act = async (method, url, body, okMsg = t('done')) => {
    try {
      const r = await api(method, url, body);
      if (okMsg) toast(okMsg, 'ok');
      return r;
    } catch (err) {
      toast(`${t('failed')}: ${err.message}`, 'bad');
      return null;
    }
  };

  // ---------------------------------------------------------------- ui helpers
  function toast(msg, kind = '') {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 3200);
    setTimeout(() => el.remove(), 3600);
  }

  /** Member picker: inputs with data-msearch=<guildId> show matching members; picking fills the id and presses the input's action. */
  S.memberNames = S.memberNames || {};
  let msTimer = null;
  function msClose() { document.querySelectorAll('.msug').forEach(n => n.remove()); }
  document.addEventListener('input', (ev) => {
    const inp = ev.target.closest?.('[data-msearch]');
    if (!inp) return;
    clearTimeout(msTimer);
    const q = inp.value.trim();
    if (q.length < 2 || /^\d{17,20}$/.test(q)) return msClose();
    msTimer = setTimeout(async () => {
      let r;
      try { r = await api('GET', `/api/guilds/${inp.dataset.msearch}/members?q=${encodeURIComponent(q)}`); } catch { return msClose(); }
      msClose();
      if (!inp.isConnected || !(r.members || []).length) return;
      const box = document.createElement('div');
      box.className = 'msug';
      box.innerHTML = r.members.map(m => `<button type="button" class="msug-i" data-mpick="${esc(m.id)}" data-mname="${esc(m.name)}">${m.avatar ? `<img src="${esc(m.avatar)}" alt="">` : `<span class="gicon">${initials(m.name)}</span>`}<b class="ell">${esc(m.name)}</b>${m.username ? `<span class="faint ell">@${esc(m.username)}</span>` : ''}${m.bot ? '<span class="pill">BOT</span>' : ''}</button>`).join('');
      inp.insertAdjacentElement('afterend', box);
    }, 300);
  });
  document.addEventListener('mousedown', (ev) => {
    const b = ev.target.closest?.('[data-mpick]');
    if (!b) { if (!ev.target.closest?.('.msug')) msClose(); return; }
    ev.preventDefault();
    const inp = b.parentElement.previousElementSibling;
    S.memberNames[b.dataset.mpick] = b.dataset.mname;
    msClose();
    if (!inp) return;
    inp.value = b.dataset.mpick;
    const btn = inp.parentElement.querySelector('[data-padd],[data-ptest]');
    if (btn) btn.click();
  });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') msClose(); });

  /** T41: web listening over WebSocket — Opus -> WebCodecs AudioDecoder -> AudioWorklet. One server at a time, listener picks the room. */
  const LS = { ws: null, ctx: null, node: null, dec: null, gid: null, sel: 'all', label: '', rooms: [], retry: 0, t: null, want: false, ts: 0, st: { rx: 0, msgs: 0, gap: 0, err: 0, under: 0, drop: 0, q: 0, last: 0 }, reconn: false, openAt: 0, wd: null, el: null, spk: new Set(), members: [], vol: {}, volOpen: false, volT: null,};
  const listenSupported = () => typeof AudioDecoder === 'function' && typeof AudioWorkletNode === 'function' && typeof WebSocket === 'function';
  function listenBtn(guildId, label) {
    if (!guildId) return '';
    const on = LS.gid === String(guildId);
    return `<button class="btn sm ${on ? 'primary' : 'ghost'}" data-listen="${esc(guildId)}" data-llabel="${esc(label || '')}" title="${esc(t(on ? 'listenStop' : 'listen'))}">🎧 ${esc(t(on ? 'listenStop' : 'listen'))}</button>`;
  }
  function listenRoomLabel(r) {
    if (r.sel === 'all') return t('listenAll');
    if (r.sel === 'main') return `${t('listenMain')}${r.channel ? ` · ${r.channel}` : ''}`;
    return `#${r.name}${r.channel ? ` · ${r.channel}` : ''}`;
  }
  function listenBar() {
    let bar = document.getElementById('listenbar');
    if (!LS.gid) { bar?.remove(); document.getElementById('listenvol')?.remove(); listenMedia(); return; }
    if (!bar) { bar = document.createElement('div'); bar.id = 'listenbar'; document.body.appendChild(bar); }
    const opts = (LS.rooms.length ? LS.rooms : [{ sel: LS.sel }]).map(r => `<option value="${esc(r.sel)}" ${r.sel === LS.sel ? 'selected' : ''}>${esc(listenRoomLabel(r))}</option>`).join('');
    bar.innerHTML = `<span class="eq"><i></i><i></i><i></i></span><span class="ell lb-name">🎧 ${esc(LS.reconn ? t('listenReconnecting') : (LS.label || t('listen')))}</span><select class="input lb-sel" data-lsel aria-label="${esc(t('listenRoom'))}">${opts}</select><button class="btn sm ghost" data-lvol title="${esc(t('listenVol'))}" aria-label="${esc(t('listenVol'))}">🎚️</button><button class="btn sm" data-listen="${esc(LS.gid)}">${esc(t('listenStop'))}</button>`;
    listenVolPanel();
    listenMedia();
  }
  function listenMedia() {
    const ms = navigator.mediaSession;
    if (!ms || typeof MediaMetadata !== 'function') return;
    try {
      if (!LS.gid) { ms.metadata = null; ms.playbackState = 'none'; return; }
      const r = LS.rooms.find(x => x.sel === LS.sel);
      ms.metadata = new MediaMetadata({ title: LS.label || 'Oud', artist: r ? listenRoomLabel(r) : t('listenAll'), album: 'Oud', artwork: [{ src: '/logo.svg', sizes: '512x512', type: 'image/svg+xml' }] });
      ms.playbackState = 'playing';
      ms.setActionHandler('pause', () => listenStop());
      ms.setActionHandler('stop', () => listenStop());
    } catch { /* unsupported */ }
  }
  function listenVolLoad(gid) {
    try { const v = JSON.parse(localStorage.getItem(`oudvol:${gid}`) || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
  }
  function listenVolSend() {
    clearTimeout(LS.volT);
    LS.volT = setTimeout(() => {
      try { localStorage.setItem(`oudvol:${LS.gid}`, JSON.stringify(LS.vol)); } catch { /* private mode */ }
      try { if (LS.ws?.readyState === 1) LS.ws.send(JSON.stringify({ vol: LS.vol })); } catch { /* closed */ }
    }, 250);
  }
  function listenVolRow(key, label, avatar) {
    const v = Math.round((LS.vol[key] ?? 1) * 100);
    const img = key === 'music' ? '<span class="lv-av lv-music">🎵</span>'
      : avatar ? `<img class="lv-av" src="${esc(avatar)}" alt="" loading="lazy">`
        : `<span class="lv-av">${esc([...String(label || '?').trim()][0] || '?')}</span>`;
    return `<div class="lv-row${LS.spk.has(String(key)) ? ' spk' : ''}" data-vrow="${esc(key)}">${img}<span class="ell lv-name" dir="auto">${esc(label)}</span><input type="range" min="0" max="200" step="10" value="${v}" data-vkey="${esc(key)}" aria-label="${esc(label)}"><span class="lv-val">${v}%</span></div>`;
  }
  function listenVolPanel() {
    let p = document.getElementById('listenvol');
    if (!LS.gid || !LS.volOpen) { p?.remove(); return; }
    if (!p) { p = document.createElement('div'); p.id = 'listenvol'; document.body.appendChild(p); }
    const rows = [listenVolRow('music', t('listenMusic'), null)]
      .concat(LS.members.map(m => listenVolRow(m.id, m.name, m.avatar)));
    p.innerHTML = `<div class="row lv-head"><b>${esc(t('listenVol'))}</b><span class="grow"></span><button class="btn sm ghost" data-lvreset>${esc(t('listenReset'))}</button></div>${rows.join('')}${LS.members.length ? '' : `<div class="muted lv-empty">${esc(t('listenNoMembers'))}</div>`}`;
  }
  document.addEventListener('input', (ev) => {
    const el = ev.target;
    if (!el?.matches?.('[data-vkey]')) return;
    const k = el.dataset.vkey;
    const v = Math.max(0, Math.min(200, Number(el.value) || 0)) / 100;
    if (v === 1) delete LS.vol[k]; else LS.vol[k] = v;
    const lab = el.parentElement?.querySelector('.lv-val');
    if (lab) lab.textContent = `${Math.round(v * 100)}%`;
    listenVolSend();
  });
  async function listenCtxInit() {
    if (!LS.ctx) {
      LS.ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'playback' });
      await LS.ctx.audioWorklet.addModule('/listen-worklet.js');
      LS.node = new AudioWorkletNode(LS.ctx, 'oud-listen', { outputChannelCount: [2] });
      // T48: route through an <audio> element so phones keep playing in the background.
      try {
        const dest = LS.ctx.createMediaStreamDestination();
        LS.node.connect(dest);
        LS.el = new Audio();
        LS.el.srcObject = dest.stream;
        await LS.el.play();
      } catch {
        LS.el = null;
        try { LS.node.disconnect(); } catch { /* not connected */ }
        LS.node.connect(LS.ctx.destination);
      }
      LS.node.port.onmessage = (e) => { const s = LS.st; s.under += e.data.under || 0; s.drop += e.data.drop || 0; s.q = e.data.q || 0; };
    }
    if (LS.ctx.state !== 'running') await LS.ctx.resume();
    if (LS.el?.paused) await LS.el.play().catch(() => {});
  }
  function listenDecoder(flush = true) {
    try { LS.dec?.close(); } catch { /* closed */ }
    if (flush) LS.node?.port.postMessage('flush');
    LS.ts = 0;
    LS.dec = new AudioDecoder({
      output: (ad) => {
        const n = ad.numberOfFrames;
        const l = new Float32Array(n);
        const r = new Float32Array(n);
        ad.copyTo(l, { planeIndex: 0, format: 'f32-planar' });
        if (ad.numberOfChannels > 1) ad.copyTo(r, { planeIndex: 1, format: 'f32-planar' }); else r.set(l);
        ad.close();
        LS.node?.port.postMessage([l, r], [l.buffer, r.buffer]);
      },
      error: () => { LS.st.err++; },
    });
    LS.dec.configure({ codec: 'opus', sampleRate: 48000, numberOfChannels: 2 });
  }
  function listenConnect() {
    clearTimeout(LS.t);
    if (!LS.gid) return;
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/listen/ws?g=${encodeURIComponent(LS.gid)}&sel=${encodeURIComponent(LS.sel)}`);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      LS.openAt = performance.now();
      clearInterval(LS.wd);
      // T47: the server sends audio (or silence) every 60 ms; nothing for 8 s = dead connection -> reconnect.
      LS.wd = setInterval(() => {
        if (LS.ws !== ws) { clearInterval(LS.wd); return; }
        if (performance.now() - Math.max(LS.st.last, LS.openAt) > 8000) { try { ws.close(); } catch { /* closed */ } }
      }, 2000);
      clearInterval(LS.stT);
      LS.stT = setInterval(() => {
        if (LS.ws !== ws || ws.readyState !== 1) { clearInterval(LS.stT); return; }
        const s = LS.st;
        try { ws.send(JSON.stringify({ stat: { rx: s.rx, msgs: s.msgs, gap: s.gap, err: s.err, under: s.under, drop: s.drop, q: s.q } })); } catch { /* closed */ }
        Object.assign(s, { rx: 0, msgs: 0, gap: 0, err: 0, under: 0, drop: 0 });
      }, 10000);
    };
    LS.ws = ws;
    ws.onmessage = (e) => {
      if (LS.ws !== ws) return;
      if (typeof e.data === 'string') {
        let m = {};
        try { m = JSON.parse(e.data); } catch { /* ignore */ }
        if (Array.isArray(m.spk)) {
          LS.spk = new Set(m.spk.map(String));
          for (const r of document.querySelectorAll('#listenvol [data-vrow]')) r.classList.toggle('spk', LS.spk.has(r.dataset.vrow));
          return;
        }
        if (Array.isArray(m.rooms)) LS.rooms = m.rooms;
        if (Array.isArray(m.members)) { LS.members = m.members; if (LS.volOpen) listenVolPanel(); }
        if (Array.isArray(m.rooms) && Object.keys(LS.vol).length) { try { ws.send(JSON.stringify({ vol: LS.vol })); } catch { /* closed */ } }
        if (m.error) { LS.want = false; const k = `listenErr_${m.error}`; toast(t(k) !== k ? t(k) : `${t('listenFailed')} — ${m.error}`, 'bad'); }
        listenBar();
        return;
      }
      LS.retry = 0;
      if (LS.reconn) { LS.reconn = false; listenBar(); }
      const now = performance.now();
      if (LS.st.last && now - LS.st.last > 250) LS.st.gap++;
      LS.st.last = now;
      LS.st.msgs++;
      if (!LS.dec || LS.dec.state === 'closed') listenDecoder(false);
      const b = new Uint8Array(e.data);
      let o = 0;
      while (o + 2 <= b.length) {
        const n = (b[o] << 8) | b[o + 1];
        o += 2;
        const f = b.subarray(o, o + n);
        o += n;
        LS.st.rx++;
        try { LS.dec.decode(new EncodedAudioChunk({ type: 'key', timestamp: LS.ts, data: f })); } catch { /* bad frame */ }
        LS.ts += 20000;
      }
    };
    ws.onclose = () => {
      if (LS.ws !== ws) return;
      LS.ws = null;
      if (!LS.want) { listenStop(); return; }
      clearInterval(LS.wd);
      if (++LS.retry > 40) { toast(t('listenFailed'), 'bad'); listenStop(); return; }
      if (!LS.reconn) { LS.reconn = true; listenBar(); }
      LS.t = setTimeout(listenConnect, Math.min(5000, 500 * LS.retry));
    };
  }
  async function listenStart(gid, label) {
    if (!listenSupported()) { toast(t('listenUnsupported'), 'bad'); return; }
    listenStop(true);
    Object.assign(LS, { gid: String(gid), label: label || '', sel: 'all', rooms: [], retry: 0, want: true, members: [], vol: listenVolLoad(String(gid)), volOpen: false });
    try { await listenCtxInit(); } catch { toast(t('listenUnsupported'), 'bad'); listenStop(); return; }
    listenDecoder();
    listenConnect();
    listenBar();
    renderPage(true);
  }
  function listenSelect(sel) {
    if (!LS.gid || sel === LS.sel) return;
    LS.sel = sel;
    LS.members = [];
    LS.spk = new Set();
    LS.retry = 0;
    const old = LS.ws;
    LS.ws = null;
    try { old?.close(); } catch { /* closed */ }
    listenDecoder();
    listenConnect();
    listenBar();
  }
  function listenStop(quiet) {
    const had = Boolean(LS.gid);
    LS.want = false;
    clearTimeout(LS.t);
    clearInterval(LS.stT);
    clearInterval(LS.wd);
    LS.reconn = false;
    const ws = LS.ws;
    LS.ws = null;
    try { ws?.close(); } catch { /* closed */ }
    try { LS.dec?.close(); } catch { /* closed */ }
    LS.dec = null;
    LS.node?.port.postMessage('flush');
    LS.ctx?.suspend().catch(() => {});
    try { LS.el?.pause(); } catch { /* none */ }
    LS.gid = null;
    listenBar();
    if (had && !quiet) renderPage(true);
  }
  document.addEventListener('change', (ev) => {
    if (ev.target?.matches?.('[data-lsel]')) listenSelect(ev.target.value);
  });
  window.addEventListener('online', () => {
    if (LS.want && LS.gid && !LS.ws) { clearTimeout(LS.t); LS.retry = 0; listenConnect(); }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !LS.gid) return;
    if (LS.ctx && LS.ctx.state !== 'running') LS.ctx.resume().catch(() => {});
    if (LS.el?.paused) LS.el.play().catch(() => {});
  });

  /** Song suggestions under play inputs: >= 3 chars, not a URL, 400 ms debounce; pick = fill URL + submit. */
  let ssTimer = null, ssSeq = 0;
  document.addEventListener('input', (ev) => {
    const inp = ev.target;
    if (!(inp instanceof HTMLInputElement) || inp.name !== 'query' || !inp.form?.matches('form[data-form="play"]')) return;
    clearTimeout(ssTimer);
    const q = inp.value.trim();
    if (q.length < 3 || /^https?:\/\//i.test(q)) return msClose();
    const seq = ++ssSeq;
    ssTimer = setTimeout(async () => {
      let r;
      try { r = await api('GET', `/api/search?q=${encodeURIComponent(q)}`); } catch { return msClose(); }
      if (seq !== ssSeq || !inp.isConnected) return;
      msClose();
      const list = (Array.isArray(r) ? r : []).slice(0, 5);
      if (!list.length) return;
      const box = document.createElement('div');
      box.className = 'msug';
      box.innerHTML = list.map(s => `<button type="button" class="msug-i" data-spick="${esc(s.url)}">${s.thumbnail ? `<img src="${esc(s.thumbnail)}" alt="" style="border-radius:6px;width:40px;height:30px;object-fit:cover">` : ''}<span class="grow" style="min-width:0"><b class="ell" style="display:block">${esc(s.title)}</b><span class="faint ell" style="display:block;font-size:12px">${esc([s.author, s.duration].filter(Boolean).join(' · '))}</span></span></button>`).join('');
      inp.form.style.position = 'relative';
      inp.form.appendChild(box);
    }, 400);
  });
  document.addEventListener('mousedown', (ev) => {
    const b = ev.target.closest?.('[data-spick]');
    if (!b) return;
    ev.preventDefault();
    const form = b.closest('form');
    const inp = form?.querySelector('input[name="query"]');
    msClose();
    if (!inp) return;
    inp.value = b.dataset.spick;
    form.requestSubmit();
  });

  function modal({ title, body = '', confirmText = t('confirm'), danger = false, typeToConfirm = null, collect = null }) {
    return new Promise((resolve) => {
      const ov = document.createElement('div');
      ov.className = 'overlay';
      ov.innerHTML = `<div class="modal" role="dialog" aria-modal="true">
        <h3>${esc(title)}</h3><div class="muted" style="margin-bottom:14px">${body}</div>
        ${typeToConfirm ? `<label class="field">${esc(t('confirmType', { x: typeToConfirm }))}<input class="input mono" id="mconf" autocomplete="off"></label>` : ''}
        <div class="row" style="justify-content:flex-end;margin-top:16px">
          <button class="btn ghost" data-m="0">${esc(t('cancel'))}</button>
          <button class="btn ${danger ? 'danger' : 'primary'}" data-m="1" ${typeToConfirm ? 'disabled' : ''}>${esc(confirmText)}</button>
        </div></div>`;
      document.body.appendChild(ov);
      const okBtn = $('[data-m="1"]', ov);
      const inp = $('#mconf', ov);
      if (inp) {
        inp.focus();
        inp.addEventListener('input', () => { okBtn.disabled = inp.value.trim() !== typeToConfirm; });
      } else okBtn.focus();
      const done = (v) => { const out = v && collect ? collect(ov) : v; ov.remove(); document.removeEventListener('keydown', onKey); resolve(out); };
      const onKey = (e) => { if (e.key === 'Escape') done(false); if (e.key === 'Enter' && !okBtn.disabled) done(true); };
      document.addEventListener('keydown', onKey);
      ov.addEventListener('click', (e) => {
        if (e.target === ov) done(false);
        const m = e.target.closest('[data-m]');
        if (m && !m.disabled) done(m.dataset.m === '1');
      });
    });
  }

  function spark(canvas, values, { max = null, color = '#e3a857' } = {}) {
    if (!canvas || !values.length) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth; const hgt = canvas.clientHeight;
    if (!w || !hgt) return;
    canvas.width = w * dpr; canvas.height = hgt * dpr;
    const c = canvas.getContext('2d');
    c.scale(dpr, dpr);
    const top = max ?? Math.max(...values, 1);
    const step = w / Math.max(1, values.length - 1);
    const pts = values.map((v, i) => [i * step, hgt - 4 - (Math.min(v, top) / top) * (hgt - 10)]);
    const grad = c.createLinearGradient(0, 0, 0, hgt);
    grad.addColorStop(0, `${color}55`); grad.addColorStop(1, `${color}00`);
    c.beginPath();
    pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.lineTo(w, hgt); c.lineTo(0, hgt); c.closePath();
    c.fillStyle = grad; c.fill();
    c.beginPath();
    pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.strokeStyle = color; c.lineWidth = 1.6; c.stroke();
  }

  // ---------------------------------------------------------------- router
  function go(hash) {
    if (location.hash !== hash) location.hash = hash;
    else route();
  }
  function parseHash() {
    const raw = location.hash.replace(/^#\/?/, '');
    const [p, qs] = raw.split('?');
    const parts = p.split('/').filter(Boolean);
    const q = new URLSearchParams(qs || '');
    if (!parts.length) return { page: 'overview', params: {}, q };
    if (parts[0] === 'server' && parts[1]) return { page: 'server', params: { id: parts[1], tab: parts[2] || null }, q };
    if (parts[0] === 'support' && parts[1]) return { page: 'support', params: { id: parts[1] }, q };
    return { page: parts[0], params: {}, q };
  }

  /** True while the user is typing or has unsent text: skip silent refreshes. */
  const busyTyping = () => {
    const a = document.activeElement;
    if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== 'range' && a.type !== 'checkbox') return true;
    return [...document.querySelectorAll('form[data-form="play"] input[name="query"]')].some(i => i.value.trim());
  };

  async function route() {
    S.route = parseHash();
    clearInterval(S.refreshTimer);
    if (S.route.page === 'login') return renderLogin();
    if (!S.me) {
      const ok = await loadMe();
      if (!ok) return go('#/login');
    }
    if (!isStaff()) {
      const ok = S.me.role === 'member' ? ['now', 'servers', 'support'] : ['now', 'servers', 'server', 'support'];
      if (!ok.includes(S.route.page)) return go('#/now');
    }
    renderShell();
    await renderPage();
    // Perms tab is a form: no silent refresh there (it would wipe typed ids).
    S.refreshTimer = setInterval(() => { if (!S.drag && !busyTyping() && !(S.route.page === 'server' && (S.route.params.tab || S.guildTab) === 'perms') && S.route.page !== 'security') renderPage(true); }, S.route.page === 'logs' ? 60_000 : 8000);
  }

  async function loadMe() {
    try {
      const r = await api('GET', '/api/me');
      S.me = { ...r.identity, user: r.user || null, sessionId: r.sessionId, initialPassword: r.initialPassword, rootOwner: Boolean(r.rootOwner) };
      S.csrf = r.csrf;
      startStream();
      return true;
    } catch { return false; }
  }

  // ---------------------------------------------------------------- live stream
  function startStream() {
    if (S.es) return;
    const es = new EventSource('/api/stream');
    S.es = es;
    es.addEventListener('tick', (e) => {
      const d = JSON.parse(e.data);
      S.queues = new Map(d.queues.map(q => [q.key, { ...q, my: q.my ?? S.queues.get(q.key)?.my }]));
      if (d.metrics && d.metrics.ts) {
        if (!S.metrics.length || S.metrics[S.metrics.length - 1].ts !== d.metrics.ts) {
          S.metrics.push(d.metrics);
          if (S.metrics.length > 720) S.metrics.shift();
        }
      }
      livePatch();
    });
    es.addEventListener('log', (e) => {
      const entry = JSON.parse(e.data);
      S.logs.push(entry);
      if (S.logs.length > 3000) S.logs.splice(0, S.logs.length - 3000);
      if (S.route.page === 'logs' && !S.logsPaused) appendLog(entry);
    });
    es.onerror = () => { /* browser retries automatically */ };
  }

  /** Update progress bars / times without re-rendering the page. */
  function livePatch() {
    for (const el of $$('[data-live-key]')) {
      const q = S.queues.get(el.dataset.liveKey);
      if (!q || !q.current) continue;
      const dur = q.current.durationSec || 0;
      const pos = dur ? Math.min(q.position || 0, dur) : (q.position || 0);
      const bar = $('.progress i', el);
      if (bar && dur) bar.style.width = `${Math.min(100, (pos / dur) * 100)}%`;
      const cur = $('[data-pos]', el);
      if (cur) cur.textContent = fmtDur(pos);
    }
    const n = $('[data-kpi="streams"]');
    if (n) n.textContent = String([...S.queues.values()].filter(q => q.playing).length);
  }

  // ---------------------------------------------------------------- shell
  const NAV = [
    ['now', '#/now', 'now', true],
    ['overview', '#/', 'home', false],
    ['servers', '#/servers', 'server', true],
    ['bots', '#/bots', 'bot', false],
    ['logs', '#/logs', 'log', false],
    ['broadcast', '#/broadcast', 'mega', false],
    ['security', '#/security', 'shield', false],
    ['support', '#/support', 'chat', true],
  ];

  function renderShell() {
    const page = S.route.page === 'server' ? 'servers' : S.route.page;
    const isMember = S.me?.role === 'member';
    const items = NAV.filter(([kk, , , all]) => isMember ? (kk === 'now' || kk === 'servers' || kk === 'support') : (all || isStaff()));
    const navLabel = (k) => (k === 'security' && !isOwner() ? t('admins') : t(k)); // T57: managers only get the admins card there
    const nav = items.map(([k, href, icon]) => `<a href="${href}" class="${page === k ? 'on' : ''}">${ic(icon)}<span>${esc(navLabel(k))}</span>${k === 'now' ? `<span class="count" data-navcount>${[...S.queues.values()].filter(q => q.playing).length || ''}</span>` : ''}</a>`).join('');
    // Phones: more than 5 pages -> first 4 + "More" (opens the side menu as a drawer with the rest).
    const mobLink = ([k, href, icon]) => `<a href="${href}" class="${page === k ? 'on' : ''}">${ic(icon)}<span>${esc(navLabel(k))}</span></a>`;
    const mob = items.length < 2 ? '' : items.length > 5
      ? items.slice(0, 4).map(mobLink).join('') + `<button type="button" class="${items.slice(4).some(([k]) => k === page) ? 'on' : ''}" data-act="sidemenu" aria-label="${esc(t('more'))}">${ic('menu')}<span>${esc(t('more'))}</span></button>`
      : items.map(mobLink).join('');
    const av = (S.me.user || {}).avatarUrl ? `<img src="${esc(S.me.user.avatarUrl)}" loading="lazy" referrerpolicy="no-referrer" alt="${esc(S.me.name)}">` : `<div class="avatar gicon" style="width:32px;height:32px;font-size:13px">${initials(S.me.name)}</div>`;
    const roleKey = { owner: 'roleOwner', manager: 'roleManager', subsadmin: 'roleSubs', guild: 'roleAdmin', admin: 'roleAdmin' }[S.me.role] || 'roleMember';
    S.userAv = (S.me.user || {}).avatarUrl
      ? `<img class="um-av" src="${esc(S.me.user.avatarUrl)}" loading="lazy" referrerpolicy="no-referrer" alt="${esc(S.me.name)}">`
      : `<span class="um-av um-gicon">${initials(S.me.name)}</span>`;
    S.roleKey = roleKey;
    S.rolePill = S.me.role === 'owner' ? 'ok' : roleKey !== 'roleMember' ? 'warn' : '';
    $('#app').innerHTML = `<div class="shell">
      <aside class="side">
        <div class="brand">${logo()}<div><b>${esc(t('appName'))}</b><small>${esc(t('tagline'))}</small></div></div>
        <nav class="nav">${nav}</nav>
        <div class="foot">
          <button class="btn ghost sm" data-act="palette">${ic('search')} ${esc(t('palette'))} <span class="kbd">Ctrl K</span></button>
          <div class="row"><button class="btn ghost sm grow" data-act="lang">${ic('globe')} ${esc(t('lang'))}</button><button class="btn ghost sm icon" data-act="theme" title="${esc(t('theme'))}">${ic(document.documentElement.dataset.theme === 'light' ? 'moon' : 'sun')}</button></div>
          <div class="me">${av}<div class="who grow"><b>${esc(S.me.name)}</b><span>${esc(t(roleKey))}</span></div><button class="btn ghost icon sm" data-act="logout" title="${esc(t('logout'))}">${ic('out')}</button></div>
        </div>
      </aside>
      <main class="main" id="main"><div class="skeleton" style="width:40%;height:26px"></div></main>
      <div class="side-scrim" data-act="sidemenu-close"></div>
      ${mob ? `<nav class="mobile-nav">${mob}</nav>` : ''}
    </div>`;
  }

  function header(title, sub = '', right = '') {
    return `<div class="top"><div class="usermenu" id="usermenu"><button class="um-btn" data-act="usermenu" title="${esc(t('logout'))}">${S.userAv || ''}<span class="um-name">${esc(S.me.name)}</span></button><div class="um-pop" id="usermenu-pop" hidden style="display:none"><div class="um-head">${S.userAv || ''}<span class="um-who"><b>${esc(S.me.name)}</b><span class="pill ${S.rolePill || ''}">${esc(t(S.roleKey || 'roleMember'))}</span></span></div><button class="um-row" data-act="logout" title="${esc(t('logout'))}">${ic('out')}<span>${esc(t('logout'))}</span></button></div></div><div><h1>${title}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div><div class="spacer"></div>${right}\n      <button class="btn ghost icon sm mobile-only" data-act="palette" title="${esc(t('palette'))}">${ic('search')}</button></div>`;
  }

  async function renderPage(silent = false) {
    const main = $('#main');
    if (!main) return;
    const page = S.route.page;
    try {
      let html = '';
      if (page === 'now') html = await pageNow();
      else if (page === 'overview' && isStaff()) html = await pageOverview();
      else if (page === 'servers') html = (isStaff() || S.me.role === 'subsadmin') ? await pageServers() : await pageMyServers();
      else if (page === 'server') html = await pageServer();
      else if (page === 'music') return go('#/now');
      else if (page === 'bots' && isStaff()) html = await pageBots();
      else if (page === 'logs' && isStaff()) {
        if (silent) return;
        html = await pageLogs();
      } else if (page === 'broadcast' && isStaff()) {
        if (silent) return;
        html = await pageBroadcast();
      } else if (page === 'security' && isStaff()) html = await pageSecurity();
      else if (page === 'support') {
        if (silent) return;
        html = await pageSupport();
      }
      else html = isStaff() ? await pageOverview() : await pageNow();
      if (silent && main.contains(document.activeElement) && document.activeElement.matches('input,textarea,select')) return;
      const scroll = window.scrollY;
      main.innerHTML = html;
      if (silent) window.scrollTo(0, scroll);
      afterRender();
    } catch (err) {
      if (!silent) main.innerHTML = `<div class="card warnbox bad">${ic('alert')}<div>${esc(err.message)}</div></div>`;
    }
  }

  function afterRender() {
    const m = S.data.metricsHist || [];
    const series = (k) => m.map(p => p[k] ?? 0);
    spark($('#sp-cpu'), series('cpu'), { color: '#e3a857' });
    spark($('#sp-mem'), series('mem'), { color: '#79a8f0' });
    spark($('#sp-pids'), series('pids'), { color: '#5fcf8f', max: m[m.length - 1]?.pidsMax || null });
    spark($('#sp-loop'), series('loopMs'), { color: '#ef6b5f' });
    if (S.route.page === 'logs') {
      const box = $('#logs');
      if (box) box.scrollTop = box.scrollHeight;
    }
    livePatch();
    void fillPlaylists();
    userMenuSet(S.umOpen); // T23g: re-apply the open state after every re-render
    if (S.route.page === 'broadcast') bcMentionWarn();
  }

  // ---------------------------------------------------------------- players
  /** Queue-action gate: a member sees only what their level allows; owner/admin (no q.my) see everything. */
  const allowed = (q, action) => {
    const a = q?.my?.actions;
    if (!a || a.includes('*')) return true;
    return a.includes(action);
  };

  function playerCard(q, { compact = false, guildName = null } = {}) {
    const cur = q.current;
    const dur = cur?.durationSec || 0;
    const pos = dur ? Math.min(q.position || 0, dur) : (q.position || 0);
    const pct = dur ? Math.min(100, (pos / dur) * 100) : 0;
    const label = q.kind === 'master' ? t('master') : `${t('slave')} #${esc(q.slaveName)}`;
    const k = esc(q.key);
    const state = q.playing ? `<span class="pill ok"><span class="eq"><i></i><i></i><i></i></span>${esc(t('live'))}</span>` : q.paused ? `<span class="pill warn">${esc(t('pause'))}</span>` : `<span class="pill">${esc(q.status)}</span>`;
    if (!cur) {
      return `<div class="card" data-live-key="${k}"><div class="row"><b>${label}</b>${guildName ? `<span class="faint">· ${esc(guildName)}</span>` : ''}<div class="spacer grow"></div><span class="pill">${esc(t('nothingPlaying'))}</span></div></div>`;
    }
    return `<div class="card" data-live-key="${k}">
      <div class="player">
        <div class="art" style="background-image:url('${esc(cur.thumbnail || '')}')"></div>
        <div style="min-width:0">
          <div class="row" style="gap:6px;margin-bottom:4px"><span class="pill gold">${label}</span>${guildName ? `<a class="faint ell" href="#/server/${esc(q.guildId)}" style="font-size:12px">${esc(guildName)}</a>` : ''}<div class="grow"></div>${state}</div>
          <div class="title" title="${esc(cur.title)}">${esc(cur.title)}</div>
          <div class="meta">${cur.requester?.name ? `<span>${esc(t('requestedBy'))} ${esc(cur.requester.name)}</span>` : ''}${q.roomOwnerName ? `<span>👑 ${esc(t('roomOwnerLbl'))}: ${esc(q.roomOwnerName)}</span>` : ''}<span class="row" style="gap:4px">${ic('vol')}${q.volume}%</span>${q.loop !== 'none' ? `<span class="pill">${ic('repeat')}${esc(q.loop)}</span>` : ''}${q.filter !== 'none' ? `<span class="pill">${esc(q.filter)}</span>` : ''}${q.length ? `<span>${esc(t('queue'))}: ${q.length}</span>` : ''}</div>
        </div>
      </div>
      <div class="progress"${allowed(q, 'seek') ? ` data-act="seekbar" data-key="${k}"` : ''} data-dur="${dur}"><i style="width:${pct}%"></i></div>
      <div class="times"><span data-pos>${fmtDur(pos)}</span><span>${dur ? fmtDur(dur) : '∞'}</span></div>
      <div class="controls">
        ${allowed(q, q.playing ? 'pause' : 'resume') ? (q.playing ? `<button class="btn sm icon" data-q="pause" data-key="${k}" title="${esc(t('pause'))}">${ic('pause')}</button>` : `<button class="btn sm icon primary" data-q="resume" data-key="${k}" title="${esc(t('resume'))}">${ic('play')}</button>`) : ''}
        ${allowed(q, 'skip') ? `<button class="btn sm icon" data-q="skip" data-key="${k}" title="${esc(t(q.my?.level === 'listener' ? 'voteSkip' : 'skip'))}">${ic('skip')}</button>` : ''}
        ${allowed(q, 'stop') ? `<button class="btn sm icon" data-q="stop" data-key="${k}" title="${esc(t('stop'))}">${ic('stop')}</button>` : ''}
        ${allowed(q, 'shuffle') ? `<button class="btn sm icon" data-q="shuffle" data-key="${k}" title="${esc(t('shuffle'))}">${ic('shuffle')}</button>` : ''}
        ${compact ? '' : S.me?.role === 'member' ? '' : `<a class="btn sm ghost" href="#/server/${esc(q.guildId)}/music">${ic('ext')}</a>`}
      </div>
    </div>`;
  }

  const roomName = (q) => (q.kind === 'master' ? t('master') : `${t('slave')} #${q.slaveName}`);

  /** One room at a time with tabs when the server has several (choice remembered per server). */
  function musicTab(qs, gid) {
    if (qs.length <= 1) return qs.map(q => `<h3 style="margin:6px 0 12px">${esc(roomName(q))}</h3>${playerFull(q)}`).join('');
    const saved = store.get(`oud.room.${gid}`, qs[0].key);
    const cur = qs.find(q => q.key === saved) || qs[0];
    const tabs = qs.map(q => `<button class="btn sm ${q.key === cur.key ? 'primary' : 'ghost'}" data-qroom="${esc(q.key)}" data-gid="${esc(gid)}">${q.playing ? '<span class="live-dot"></span>' : ''}${esc(roomName(q))}</button>`).join('');
    return `<div class="row room-tabs">${tabs}</div>${playerFull(cur)}`;
  }

  /** Fill each room's playlists card (cached 30 s per room). */
  async function fillPlaylists() {
    for (const box of document.querySelectorAll('[data-pllist]')) {
      const key = box.dataset.pllist;
      let c = S.plCache.get(key);
      if (!c || Date.now() - c.at > 30_000) {
        try {
          const r = await api('GET', `/api/queues/${encodeURIComponent(key)}/playlists`);
          c = { at: Date.now(), list: r.playlists || [] };
          S.plCache.set(key, c);
        } catch { continue; }
      }
      if (!box.isConnected) continue;
      const canPlay = box.dataset.canplay === '1';
      box.innerHTML = c.list.length
        ? `<form class="row" data-form="loadpl" data-key="${esc(key)}"><select class="input grow" name="name">${c.list.map(pl => `<option value="${esc(pl.name)}">${esc(pl.name)} (${pl.count})</option>`).join('')}</select><button class="btn primary" type="submit" ${canPlay ? '' : `disabled title="${esc(t('cantPlay'))}"`}>${esc(t('load'))}</button></form>${canPlay ? '' : `<div class="faint" style="font-size:12px;margin-top:4px">${esc(t('cantPlay'))}</div>`}`
        : `<div class="faint">${esc(t('noPl'))}</div>`;
    }
  }

  function playerFull(q) {
    const k = esc(q.key);
    const filters = ['none', 'bass', 'treble', 'eightd', 'wide', 'reverb', 'phone', 'radio', 'nightcore', 'vaporwave', 'slowed'];
    const tracks = q.tracks || [];
    const list = tracks.length ? tracks.map((tr, i) => `<div class="item" draggable="true" data-drag-index="${i + 1}" data-key="${k}">
        <span class="idx">${i + 1}</span>${tr.thumbnail ? `<img class="thumb" src="${esc(tr.thumbnail)}" alt="" loading="lazy">` : '<div class="thumb"></div>'}
        <div class="grow" style="min-width:0"><div class="ell" style="font-weight:600">${esc(tr.title)}</div><div class="faint" style="font-size:12px">${tr.durationSec ? fmtDur(tr.durationSec) : ''}${tr.requester?.name ? ` · ${esc(tr.requester.name)}` : ''}</div></div>
        <div class="acts">
          <button class="btn sm icon ghost" data-q="jump" data-key="${k}" data-index="${i + 1}" title="${esc(t('play'))}">${ic('play')}</button>
          ${i > 0 ? `<button class="btn sm icon ghost" data-q="moveto" data-to="1" data-key="${k}" data-index="${i + 1}" title="${esc(t('toTop'))}">⤒</button>` : ''}
          <button class="btn sm icon ghost" data-q="move" data-dir="up" data-key="${k}" data-index="${i + 1}">${ic('up')}</button>
          <button class="btn sm icon ghost" data-q="move" data-dir="down" data-key="${k}" data-index="${i + 1}">${ic('down')}</button>
          <button class="btn sm icon ghost" data-q="remove" data-key="${k}" data-index="${i + 1}">${ic('trash')}</button>
        </div></div>`).join('') : `<div class="empty">${ic('music')}<div>${esc(t('queue'))} ${esc(t('empty'))}</div></div>`;
    const hist = (q.history || []).slice(0, 8).map(tr => `<div class="item"><img class="thumb" src="${esc(tr.thumbnail || '')}" alt="" loading="lazy"><div class="grow ell">${esc(tr.title)}</div><button class="btn sm ghost" data-replay="${esc(tr.url || '')}" data-key="${k}">${ic('plus')}</button></div>`).join('');
    return `<div class="grid g2" style="align-items:start">
      <div class="grid">
        ${playerCard(q, { compact: true })}
        <div class="card">
          <form class="row" data-form="play" data-key="${k}">
            <input class="input grow" name="query" placeholder="${esc(t('addTrack'))}" autocomplete="off">
            <button class="btn primary" type="submit">${ic('plus')} ${esc(t('add'))}</button>
            <button class="btn" type="submit" name="next" value="1">${esc(t('playNext'))}</button>
          </form>
          <div class="list" data-results="${k}" style="margin-top:8px"></div>
        </div>
        <div class="card">
          <h3>${ic('layers')} ${esc(t('playlists'))}</h3>
          <div data-pllist="${k}" data-canplay="${q.canPlay ? '1' : '0'}"><div class="faint">…</div></div>
          <form class="row" data-form="savepl" data-key="${k}" style="margin-top:8px">
            <input class="input grow" name="name" maxlength="50" placeholder="${esc(t('plNamePh'))}" autocomplete="off">
            <button class="btn" type="submit">${esc(t('saveQueue'))}</button>
          </form>
        </div>
        <div class="card">
          <div class="grid g2">
            <label class="field">${esc(t('volume'))} <span class="mono" data-volv="${k}">${q.volume}%</span><input type="range" min="0" max="200" step="5" value="${q.volume}" data-change="volume" data-key="${k}"></label>
            <label class="field">${esc(t('filter'))}<select class="input" data-change="filter" data-key="${k}">${filters.map(f => `<option value="${f}" ${q.filter === f ? 'selected' : ''}>${f}</option>`).join('')}</select></label>
            <label class="field">${esc(t('loopMode'))}<select class="input" data-change="loop" data-key="${k}">${[['none', t('loopNone')], ['queue', t('loopQueue')], ['track', t('loopTrack')]].map(([v, n]) => `<option value="${v}" ${q.loop === v ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
            <label class="field">${esc(t('autoDj'))}<div class="row"><label class="switch"><input type="checkbox" data-change="autodj" data-key="${k}" ${q.autoDj ? 'checked' : ''}><span></span></label><select class="input" data-change="adjmode" data-key="${k}"><option value="similar" ${q.autoDjMode === 'similar' ? 'selected' : ''}>${esc(t('adjSimilar'))}</option><option value="mood" ${q.autoDjMode !== 'similar' ? 'selected' : ''}>${esc(t('adjMood'))}</option></select></div>${q.autoDjMode !== 'similar' ? `<input class="input" data-adjq="${k}" value="${esc(q.autoDjQuery || '')}" placeholder="${esc(t('adjMoodPh'))}" maxlength="100" style="margin-top:6px">` : ''}</label>
          </div>
        </div>
      </div>
      <div class="grid">
        <div class="card"><h3>${ic('layers')} ${esc(t('queue'))} <span class="muted">${q.length}</span><div class="grow"></div>${q.length ? `<button class="btn sm ghost" data-q="clear" data-key="${k}">${ic('trash')} ${esc(t('clear'))}</button>` : ''}</h3><div class="list">${list}</div></div>
        ${hist ? `<div class="card"><h3>${ic('clock')} ${esc(t('history'))}</h3><div class="list">${hist}</div></div>` : ''}
      </div>
    </div>`;
  }

  // ---------------------------------------------------------------- pages
  async function pageOverview() {
    const [o, hist] = await Promise.all([api('GET', '/api/overview'), api('GET', '/api/metrics?points=180')]);
    S.data.overview = o;
    S.data.metricsHist = hist;
    S.queues = new Map(o.nowPlaying.map(q => [q.key, q]));
    const m = o.metrics || {};
    const b = o.bot;
    const memPct = m.memMax ? (m.mem / m.memMax) * 100 : 0;
    const pidPct = m.pidsMax ? (m.pids / m.pidsMax) * 100 : 0;
    const cpuPct = m.cpuLimit ? m.cpu / m.cpuLimit : m.cpu;
    const lvl = (p) => (p > 85 ? 'bad' : p > 65 ? 'warn' : '');
    const w = o.warnings;
    let warn = '';
    if (w) {
      const items = [];
      for (const a of o.alerts || []) items.push(`<div class="warnbox ${a.level === 'bad' ? 'bad' : ''}">${ic('alert')}<div class="grow"><b>${esc(a.text)}</b> <span class="faint">· ${esc(ago(a.since))}</span></div></div>`);
      if (w.initialPassword) items.push(`<div class="warnbox">${ic('key')}<div class="grow">${esc(t('initialPw'))}</div><a class="btn sm" href="#/security">${esc(t('open'))}</a></div>`);
      if (w.unknownGuilds?.length) {
        items.push(`<div class="warnbox">${ic('alert')}<div class="grow"><b>${esc(t('unknownGuilds'))} (${w.unknownGuilds.length})</b>
          <div class="list" style="margin-top:6px">${w.unknownGuilds.map(g => `<div class="item">${g.icon ? `<img class="gicon" style="width:30px;height:30px;border-radius:9px" src="${esc(g.icon)}" alt="">` : `<div class="gicon" style="width:30px;height:30px;font-size:12px">${initials(g.name)}</div>`}<div class="grow ell">${esc(g.name)} <span class="faint mono">${esc(g.id)}</span></div><a class="btn sm" href="#/server/${esc(g.id)}/sub">${ic('plus')}</a><button class="btn sm danger" data-leave="${esc(g.id)}" data-name="${esc(g.name)}">${esc(t('leave'))}</button></div>`).join('')}</div></div></div>`);
      }
      if (items.length) warn = `<div class="card"><h3>${ic('alert')} ${esc(t('warnings'))}</h3><div class="grid">${items.join('')}</div></div>`;
    }
    const ah = (a) => {
      const lost = a.rooms.reduce((s, r) => s + r.lost, 0);
      const under = a.web ? a.web.under : 0;
      const bad = a.cut > 15 || a.starve > 0 || under > 50;
      const warn = a.cut > 5 || lost > 20 || under > 0;
      return `<div class="item"><span class="dot ${bad ? 'bad' : warn ? 'warn' : 'live'}"></span><div class="grow ell"><b>${esc(a.name)}</b><div class="faint" style="font-size:12px">${esc(t('ahCuts'))} ${a.cut} · ${esc(t('ahLost'))} ${lost} · ${esc(t('ahWeb'))} ${a.listeners}${a.web ? ` (${esc(t('ahUnder'))} ${under})` : ''} · lag ${a.lag99}ms</div></div></div>`;
    };
    const audioCard = isStaff() ? `<div class="card"><h3>${ic('wave')} ${esc(t('audioHealth'))} <span class="faint" style="font-size:12px;font-weight:400">${esc(t('last30s'))}</span></h3>${(o.audio || []).length ? `<div class="list">${o.audio.map(ah).join('')}</div>` : `<div class="muted">${esc(t('ahNone'))}</div>`}</div>` : '';
    const boot = b.boot?.masterReadyAt ? `${b.boot.masterReadyAt}s${b.boot.slavesReadyAt ? ` / ${b.boot.slavesReadyAt}s` : ''}` : '—';
    const n = o.nowPlaying.length;
    const playingCard = `<a class="card row" style="color:inherit;gap:10px;margin-top:12px" href="#/now">${ic('music')}<b>${n ? `${n} ${esc(t('nowPlayingCount'))}` : esc(t('nothingPlaying'))}</b><span class="grow"></span><span class="faint">${esc(t('now'))} →</span></a>`;
    return `${header(esc(t('overview')), esc(new Date().toLocaleString(lang === 'ar' ? 'ar-SA-u-ca-gregory' : 'en-GB')))}
      <div class="grid">
        <div class="card hero">
          ${b.avatar ? `<img src="${esc(b.avatar)}" alt="">` : logo()}
          <div><h2>${esc(b.tag || 'Oud')}</h2><div class="row" style="gap:8px;margin-top:4px"><span class="pill ${b.ready ? 'ok' : 'bad'}"><span class="dot ${b.ready ? 'live' : 'bad'}"></span>${esc(b.ready ? t('online') : t('offline'))}</span><span class="pill">Node ${esc(b.node)}</span></div></div>
          <div class="stats">
            <div class="stat"><b>${b.ping ?? '—'}<small class="faint"> ms</small></b><span>${esc(t('ping'))}</span></div>
            <div class="stat"><b>${fmtUptime(b.uptimeSec)}</b><span>${esc(t('uptime'))}</span></div>
            <div class="stat"><b class="mono">${esc(boot)}</b><span>${esc(t('boot'))}</span></div>
          </div>
        </div>
        ${warn}
        <div class="grid g4 kpis">
          <div class="card kpi"><div class="label">${ic('server')} ${esc(t('subscribed'))}</div><div class="value">${o.counts.subscribed}<small>/ ${o.counts.guilds}</small></div><div class="hint">${o.counts.expired ? `${o.counts.expired} ${esc(t('expired'))}` : '&nbsp;'}</div></div>
          <div class="card kpi"><div class="label">${ic('music')} ${esc(t('streams'))}</div><div class="value" data-kpi="streams">${o.counts.streams}</div><div class="hint">${o.counts.voice} ${esc(t('voice'))}</div></div>
          <div class="card kpi"><div class="label">${ic('bot')} ${esc(t('slaves'))}</div><div class="value">${o.counts.slavesOnline}<small>/ ${o.counts.slaves}</small></div><div class="hint">${esc(t('today'))}: ${o.stats?.todayPlays ?? 0} ${esc(t('plays'))} · ${((o.stats?.todaySeconds || 0) / 3600).toFixed(1)} ${esc(t('hr'))}</div></div>
          <div class="card kpi"><div class="label">${ic('alert')} ${esc(t('errors'))}</div><div class="value" style="color:${o.counts.error ? 'var(--bad)' : 'inherit'}">${o.counts.error}<small>${o.counts.warn} warn</small></div><div class="hint">${isStaff() ? `<a href="#/logs">${esc(t('logs'))} →</a>` : '&nbsp;'}</div></div>
        </div>
        ${isStaff() ? `<div class="grid g4 kpis">
          <div class="card kpi"><div class="label">${ic('cpu')} ${esc(t('cpu'))}</div><div class="value">${Math.round(cpuPct)}<small>%</small></div><div class="hint">${m.cpu}% ${esc(t('ofCore'))} · ${esc(t('limit'))} ${m.cpuLimit}</div><canvas id="sp-cpu"></canvas></div>
          <div class="card kpi"><div class="label">${ic('layers')} ${esc(t('ram'))}</div><div class="value">${fmtBytes(m.mem)}</div><div class="hint">${esc(t('limit'))} ${fmtBytes(m.memMax)}</div><div class="bar ${lvl(memPct)}"><i style="width:${memPct}%"></i></div><canvas id="sp-mem"></canvas></div>
          <div class="card kpi"><div class="label">${ic('bolt')} ${esc(t('pids'))}</div><div class="value">${m.pids ?? '—'}<small>/ ${m.pidsMax ?? '∞'}</small></div><div class="hint">ffmpeg ${m.ffmpeg} · yt-dlp ${m.ytdlp}${o.prefetch?.enabled ? ` · ${esc(t('warmStarts'))} ${o.prefetch.hits}/${o.prefetch.hits + o.prefetch.misses}` : ''}</div><div class="bar ${lvl(pidPct)}"><i style="width:${pidPct}%"></i></div><canvas id="sp-pids"></canvas></div>
          <div class="card kpi"><div class="label">${ic('wave')} ${esc(t('loop'))}</div><div class="value">${m.loopMs}<small>ms</small></div><div class="hint">max ${m.loopMaxMs} ms · ${esc(t('last1h'))}</div><canvas id="sp-loop"></canvas></div>
        </div>` : ''}
        ${audioCard}
        ${playingCard}
      </div>`;
  }

  function subBadge(s) {
    if (!s.exists) return `<span class="pill">${esc(t('none'))}</span>`;
    if (s.expired) return `<span class="pill bad">${esc(t('expired'))}</span>`;
    if (!s.allowed) return `<span class="pill warn">${esc(t('disabled'))}</span>`;
    if (s.lifetime) return `<span class="pill gold">${esc(t('lifetime'))}</span>`;
    const days = Math.ceil((Date.parse(s.expires) - Date.now()) / 86400_000);
    return `<span class="pill ${days <= 7 ? 'warn' : 'ok'}">${esc(t('daysLeft', { n: days }))}</span>`;
  }

  function guildIcon(g, size = 46) {
    return g.icon ? `<img class="gicon" style="width:${size}px;height:${size}px" src="${esc(g.icon)}" alt="">` : `<div class="gicon" style="width:${size}px;height:${size}px">${initials(g.name)}</div>`;
  }

  async function pageServers() {
    const list = await api('GET', '/api/guilds');
    S.data.guilds = list;
    const f = S.guildFilter;
    const q = S.guildSearch.toLowerCase();
    const shown = list.filter(g => {
      if (q && !g.name.toLowerCase().includes(q) && !g.id.includes(q)) return false;
      if (f === 'active') return g.subscription.allowed;
      if (f === 'expired') return g.subscription.expired;
      if (f === 'none') return !g.subscription.exists;
      return true;
    });
    const counts = {
      all: list.length,
      active: list.filter(g => g.subscription.allowed).length,
      expired: list.filter(g => g.subscription.expired).length,
      none: list.filter(g => !g.subscription.exists).length,
    };
    const cards = shown.map(g => {
      const s = g.subscription;
      const feats = [s.music && 'music', s.bridge && 'bridge', s.slaves && `${t('slaves')} ${g.slavesOnline}/${s.maxSlaves}`].filter(Boolean);
      return `<a class="card gcard" href="#/server/${esc(g.id)}">
        <div class="ghead">${guildIcon(g)}<div class="grow" style="min-width:0"><b class="ell" style="display:block">${esc(g.name)}</b><span class="faint mono" style="font-size:11.5px">${esc(g.id)}</span></div>${subBadge(s)}</div>
        <div class="chips">${feats.map(x => `<span class="pill">${esc(x)}</span>`).join('')}<span class="pill ${g.voice.status === 'ready' ? 'ok' : g.voice.paused ? 'warn' : ''}"><span class="dot ${g.voice.status === 'ready' ? 'ok' : g.voice.paused ? 'warn' : ''}"></span>${esc(g.voice.status)}</span>${g.memberCount ? `<span class="pill">${g.memberCount} ${esc(t('members'))}</span>` : ''}${!g.inGuild ? `<span class="pill bad">${esc(t('notInGuild'))}</span>` : ''}</div>
        ${g.nowPlaying ? `<div class="row faint" style="font-size:12.5px"><span class="eq"><i></i><i></i><i></i></span><span class="ell grow">${esc(g.nowPlaying.title)}</span></div>` : ''}
      </a>`;
    }).join('');
    const filt = ['all', 'active', 'expired', 'none'].map(k => `<button class="${f === k ? 'on' : ''}" data-gfilter="${k}">${esc(t(k))} · ${counts[k]}</button>`).join('');
    return `${header(esc(t('servers')), `${list.length}`)}
      <div class="row" style="margin-bottom:16px"><input class="input" style="max-width:320px" placeholder="${esc(t('search'))}" value="${esc(S.guildSearch)}" data-gsearch><div class="filters">${filt}</div></div>
      <div class="grid auto">${cards || `<div class="card empty">${esc(t('empty'))}</div>`}</div>`;
  }

  async function pageServer() {
    const { id } = S.route.params;
    const g = await api('GET', `/api/guilds/${id}`);
    S.data.guild = g;
    for (const q of g.queues) if (q.current) S.queues.set(q.key, q);
    // Owner / managers: every tab. Server admin: what the owner left visible (T81 g.view: show / read / hide).
    const subs = isStaff() || S.me.role === 'subsadmin';
    const v = g.view || {};
    const vis = (k) => v[k] !== 'hide';
    const tabs = g.access === 'subs' ? [['sub', t('tabSub')]] : [
      ...(vis('music') ? [['music', t('tabMusic')]] : []),
      ...(vis('stats') ? [['stats', t('tabStats')]] : []),
      ...(vis('bridge') ? [['bridge', t('tabBridge')]] : []),
      ...(subs ? [['sub', t('tabSub')]] : vis('plan') ? [['plan', t('tabPlan')]] : []),
      ...(vis('rooms') || vis('voice') || vis('roomBots') ? [['rooms', t('tabRooms')]] : []),
      ...(vis('perms') ? [['perms', t('permsTab')]] : []),
      ...(isStaff() ? [['adminview', t('tabAdminView')]] : []),
      ...(isOwner() ? [['danger', t('tabDanger')]] : [])];
    if (!tabs.length) return `${header(esc(g.name))}<div class="card empty">${ic('shield')}<div>${esc(t('avNothing'))}</div></div>`;
    let tab = S.route.params.tab || S.guildTab || 'music';
    if (!tabs.some(([k]) => k === tab)) tab = tabs[0][0];
    let body;
    if (tab === 'music') body = roWrap(musicTab(g.queues || [], S.route.params.id), v.music) + (vis('guests') ? roWrap(guestCard(g), v.guests) : '');
    else if (tab === 'stats') body = statsTab(g);
    else if (tab === 'bridge') body = roWrap(bridgeTab(g), v.bridge);
    else if (tab === 'sub') body = subTab(g);
    else if (tab === 'plan') body = roWrap(planTab(g), v.plan);
    else if (tab === 'rooms') body = roomsTab(g);
    else if (tab === 'perms') body = roWrap(await permsTab(id), v.perms);
    else if (tab === 'adminview') body = await adminViewTab(id);
    else body = dangerTab(g);
    return `${header(`<span class="row" style="gap:12px">${guildIcon(g, 40)}<span>${esc(g.name)}</span></span>`, `<span class="mono">${esc(g.id)}</span> · ${subBadge(g.subscription)}`, `<a class="btn ghost sm" href="#/servers">${ic(document.dir === 'rtl' ? 'skip' : 'skip')} ${esc(t('servers'))}</a>`)}
      <div class="tabs">${tabs.map(([k, n]) => `<button class="${tab === k ? 'on' : ''}" data-gtab="${k}">${esc(n)}</button>`).join('')}</div>${body}`;
  }

  // T81: "read" sections show everything with the controls switched off.
  function roWrap(html, lvl) {
    if (lvl !== 'read' || !html) return html;
    return `<div class="ro"><div class="ro-note faint">👁️ ${esc(t('viewOnly'))}</div>${html}</div>`;
  }

  // T81: owner / managers choose what server admins see (default for every server + this server).
  // T82: one-tap presets (fill the selects; Save applies). Missing sections = hide.
  const AV_PRESETS = {
    full: { music: 'show', stats: 'show', plan: 'show', rooms: 'show', voice: 'show', roomBots: 'show', botEdit: 'show', bridge: 'show', guests: 'show', webListen: 'show', perms: 'show' },
    music: { music: 'show', stats: 'show', plan: 'show', guests: 'show', webListen: 'show' },
    view: { music: 'read', stats: 'show', plan: 'read', rooms: 'read', voice: 'read', roomBots: 'read', botEdit: 'read', bridge: 'read', guests: 'read', webListen: 'show', perms: 'read' },
    none: {},
  };

  async function adminViewTab(gid) {
    const a = await api('GET', `/api/guilds/${gid}/adminview`);
    const opt = (cur, withInherit) => [...(withInherit ? ['inherit'] : []), ...a.levels].map(l => `<option value="${l}" ${cur === l ? 'selected' : ''}>${esc(t('lvl_' + l))}</option>`).join('');
    const rows = a.sections.map(sct => `<div class="av-row"><div class="av-h"><b>${esc(t('sec_' + sct))}</b><div class="faint" style="font-size:12px">${esc(t('sech_' + sct))}</div></div>
      <span class="pill ${a.effective[sct] === 'show' ? 'ok' : a.effective[sct] === 'read' ? 'warn' : 'bad'}" title="${esc(t('avNow'))}">${esc(t('lvl_' + a.effective[sct]))}</span>
      <div class="av-sel"><label class="field">${esc(t('avDefault'))}<select class="input" data-avdef="${sct}">${opt(a.default[sct] || 'show', false)}</select></label>
      <label class="field">${esc(t('avThis'))}<select class="input" data-avg="${sct}">${opt(a.guild[sct] || 'inherit', true)}</select></label></div></div>`).join('');
    return `<div class="card"><h3>${ic('shield')} ${esc(t('tabAdminView'))}</h3><p class="faint" style="font-size:12.5px;margin:0 0 10px">${esc(t('avHint'))}</p>
      <div class="av-pre"><b>${esc(t('avPresets'))}</b><select class="input" id="av-target" aria-label="${esc(t('avApplyTo'))}"><option value="g">${esc(t('avThis'))}</option><option value="def">${esc(t('avDefault'))}</option></select>
        <div class="av-pbtns">${Object.keys(AV_PRESETS).map(k => `<button class="btn sm" data-act="avpreset" data-preset="${k}">${esc(t('avp_' + k))}</button>`).join('')}</div>
        <div class="faint" style="font-size:12px;flex-basis:100%">${esc(t('avPresetHint'))}</div></div>
      <div class="av-list">${rows}</div>
      <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn primary" data-act="avsave" data-gid="${esc(gid)}">${esc(t('save'))}</button></div></div>`;
  }

  function statsTab(g) {
    const st = g.stats;
    if (!st || !st.plays) return `<div class="card empty">${ic('wave')}<div>${esc(t('noStats'))}</div></div>`;
    const maxDay = Math.max(1, ...st.days.map(d => d.plays));
    const bars = st.days.map(d => `<div class="dbar" title="${esc(d.day)}: ${d.plays} ${esc(t('plays'))}"><i style="height:${Math.round((d.plays / maxDay) * 100)}%"></i></div>`).join('');
    const maxH = Math.max(1, ...st.hours);
    const heat = st.hours.map((v, h) => `<div class="hcell" title="${h}:00 UTC · ${v}" style="opacity:${0.12 + (v / maxH) * 0.88}"><span>${h}</span></div>`).join('');
    const tracks = st.topTracks.map((tr, i) => `<div class="item"><span class="idx">${i + 1}</span>${tr.thumbnail ? `<img class="thumb" src="${esc(tr.thumbnail)}" alt="" loading="lazy">` : '<div class="thumb"></div>'}<div class="grow ell">${esc(tr.title)}</div><span class="pill gold">${tr.count}×</span>${/^https?:/.test(tr.url) ? `<button class="btn sm ghost" data-replay="${esc(tr.url)}" data-key="${esc(`guild:${g.id}`)}" title="${esc(t('add'))}">${ic('plus')}</button>` : ''}</div>`).join('');
    const djs = st.topDjs.map((d, i) => `<div class="item"><span class="idx">${i + 1}</span><div class="grow ell">${esc(d.name)}</div><span class="pill">${d.count}</span></div>`).join('');
    return `<div class="grid">
      <div class="grid g3 kpis">
        <div class="card kpi"><div class="label">${ic('music')} ${esc(t('plays'))}</div><div class="value">${st.plays}</div></div>
        <div class="card kpi"><div class="label">${ic('clock')} ${esc(t('hoursPlayed'))}</div><div class="value">${(st.seconds / 3600).toFixed(1)}</div></div>
        <div class="card kpi"><div class="label">${ic('bolt')} ${esc(t('today'))}</div><div class="value">${st.days[st.days.length - 1].plays}</div></div>
      </div>
      <div class="card"><h3>${ic('wave')} ${esc(t('last30'))}</h3><div class="dbars">${bars}</div></div>
      <div class="grid g2" style="align-items:start">
        <div class="card"><h3>${ic('music')} ${esc(t('topTracks'))}</h3><div class="list">${tracks}</div></div>
        <div class="grid"><div class="card"><h3>${ic('mic')} ${esc(t('topDjs'))}</h3><div class="list">${djs || '<div class="faint">—</div>'}</div></div>
        <div class="card"><h3>${ic('clock')} ${esc(t('byHour'))}</h3><div class="heat">${heat}</div></div></div>
      </div></div>`;
  }

  function guestCard(g) {
    if (!g.subscription?.webListen) return '';
    const hours = [[1, t('gh1')], [6, t('gh6')], [24, t('gh24')], [168, t('gh168')]];
    const when = (iso) => new Date(iso).toLocaleString(lang === 'ar' ? 'ar-SA-u-ca-gregory' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });
    const rows = (g.guests || []).map(l => `<div class="item"><div class="grow ell"><b>${esc(l.label || t('guestNoLabel'))}</b><div class="faint" style="font-size:12px">${esc(t('guestUntil'))} ${esc(when(l.exp))} · 🎧 ${Number(l.listeners) || 0}</div></div><button class="btn sm danger" data-guestrevoke="${esc(l.id)}">${esc(t('guestRevoke'))}</button></div>`).join('');
    const fresh = S.guestNew && S.guestNew.gid === g.id ? `<div class="warnbox" style="margin-top:10px"><div class="grow" style="min-width:0"><b>${esc(t('guestCopyNow'))}</b><input class="input mono" readonly value="${esc(S.guestNew.url)}" data-guesturl style="margin-top:6px;width:100%"></div><button class="btn sm primary" data-copy="${esc(S.guestNew.url)}">${esc(t('guestCopy'))}</button></div>` : '';
    return `<div class="card" style="margin-top:12px"><h3>🔗 ${esc(t('guestLinks'))}</h3><div class="muted" style="font-size:13px;margin-bottom:10px">${esc(t('guestHint'))}</div>
      <div class="row" style="gap:8px;flex-wrap:wrap"><input class="input" id="guest-label" maxlength="40" placeholder="${esc(t('guestLabel'))}" style="flex:1 1 160px;min-width:0"><select class="input" id="guest-hours" style="flex:0 0 auto;width:auto">${hours.map(([h, l]) => `<option value="${h}" ${h === 24 ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select><button class="btn primary" data-guestnew="${esc(g.id)}">${esc(t('guestCreate'))}</button></div>
      ${fresh}${rows ? `<div class="list" style="margin-top:10px">${rows}</div>` : `<div class="faint" style="margin-top:10px">${esc(t('guestNone'))}</div>`}</div>`;
  }

  function bridgeTab(g) {
    if (!g.subscription.bridge) {
      return `<div class="card warnbox" style="margin-bottom:14px;align-items:center">${ic('alert')}<div class="grow">${esc(t('bridgeOff'))}</div><button class="btn sm" data-gtab="sub">${esc(t('tabSub'))}</button></div>${g.slaves.length ? `<div class="bridge-off">${mixer(g)}</div>` : ''}`;
    }
    return mixer(g);
  }

  function mixer(g) {
    if (!g.slaves.length) return `<div class="card empty">${ic('bot')}<div>${esc(t('slaves'))}: 0</div></div>`;
    const strips = g.slaves.map(s => {
      const level = s.lastAt && Date.now() - s.lastAt < 2000 ? Math.min(100, (s.fps / 50) * 100) : 0;
      const ms = Array.isArray(s.members) ? s.members : [];
      const all = S.rpAll?.[s.name];
      const shown = all ? ms : ms.slice(0, 6);
      const people = ms.length
        ? `<div class="rpeople ${all ? 'all' : ''}">${shown.map(m => `<button type="button" class="rp ${m.speaking ? 'talk' : ''} ${m.bridgeMuted ? 'bm' : ''}" data-bridge="usermute" data-room="${esc(s.name)}" data-user="${esc(m.id)}" title="${esc(`${m.name} · ${m.bridgeMuted ? t('personUnmute') : t('personMute')}`)}">${m.avatar ? `<img src="${esc(m.avatar)}" alt="" loading="lazy">` : `<span class="rp-i">${esc(String(m.name || '?').slice(0, 1))}</span>`}<span class="ell" dir="auto">${esc(m.name)}</span>${m.bridgeMuted ? '<span class="pill bad rp-bm">🔇</span>' : m.muted ? '🎙️✕' : ''}</button>`).join('')}${ms.length > 6 ? `<button class="btn sm ghost" data-act="rpall" data-room="${esc(s.name)}">${all ? esc(t('showLess')) : `+${ms.length - 6}`}</button>` : ''}</div>`
        : `<div class="faint" style="font-size:12px">${esc(t('roomEmpty'))}</div>`;
      return `<div class="strip ${s.solo ? 'solo' : ''} ${s.muted ? 'muted' : ''}">
        <div class="row" style="justify-content:space-between"><b>#${esc(s.name)}</b>${ms.length ? ` <span class="muted" style="font-size:12px">👥 ${ms.length}</span>` : ''}<span class="dot ${s.connStatus === 'ready' ? 'ok' : 'bad'}"></span></div>
        <div class="faint ell" style="font-size:11.5px">${esc(s.tag)}</div>
        ${people}
        <div class="lvl"><i style="width:${level}%"></i></div>
        <div class="faint" style="font-size:11.5px">${s.activity?.emoji || ''} ${esc(({ Live: t('live'), Silent: t('silent'), Idle: t('idleBot') })[s.activity?.label] || s.activity?.label || '')} · ${s.fps} ${esc(t('fps'))}</div>
        ${s.colliding ? `<span class="pill warn">${esc(t('collision'))}</span>` : ''}
        <input type="range" min="0" max="200" step="5" value="${s.volume ?? 100}" data-bridge="volume" data-room="${esc(s.name)}" title="${esc(t('volume'))}">
        <div class="row" style="gap:6px">
          <button class="btn sm grow ${s.muted ? 'danger' : ''}" data-bridge="mute" data-room="${esc(s.name)}">${esc(s.muted ? t('unmute') : t('mute'))}</button>
          <button class="btn sm grow ${s.solo ? 'primary' : ''}" data-bridge="solo" data-room="${esc(s.solo ? 'off' : s.name)}">${esc(s.solo ? t('soloOff') : t('solo'))}</button>
        </div>
        <label class="row" style="justify-content:space-between;font-size:12px"><span class="muted">${esc(t('enabled'))}</span><label class="switch"><input type="checkbox" data-bridge="enable" data-room="${esc(s.name)}" ${s.bridgeEnabled ? 'checked' : ''}><span></span></label></label>
      </div>`;
    }).join('');
    return `<div class="card"><h3 style="display:flex;align-items:center;gap:8px">${ic('mic')} ${esc(t('tabBridge'))} <span class="muted">${g.slaves.length}</span><span class="grow"></span>${(g.view || {}).webListen === 'hide' ? '' : listenBtn(g.id, g.name)}</h3><div class="mixer">${strips}</div></div>`;
  }

  // T65: owner picks the admin server (subscription panel + subscription admins' roles live there).
  function adminGuildCard(ag) {
    if (!ag) return '';
    const opts = [`<option value="">— ${esc(t('agNone'))}</option>`, ...ag.options.map(o => `<option value="${esc(o.id)}" ${o.id === ag.id ? 'selected' : ''}>${esc(o.name)}</option>`)].join('');
    const cur = ag.id ? `${esc(ag.name || ag.id)} <span class="mono faint" style="font-size:12px">${esc(ag.id)}</span>${ag.source === 'env' ? ` <span class="pill">${esc(t('agFromEnv'))}</span>` : ''}` : `<span class="faint">${esc(t('agNone'))}</span>`;
    return `<div class="card"><h3>${ic('shield')} ${esc(t('agTitle'))}</h3><p class="faint" style="font-size:12px;margin:0 0 8px">${esc(t('agHint'))}</p>
      <div style="margin-bottom:10px">${cur}</div>
      <form class="row" data-form="adminguild"><select class="input grow" name="guildId">${opts}</select><button class="btn primary" type="submit">${esc(t('save'))}</button></form></div>`;
  }

  // T64: read-only plan card for server admins.
  function planTab(g) {
    const s = g.subscription || {};
    const days = s.expires ? Math.ceil((Date.parse(s.expires) - Date.now()) / 86400000) : null;
    let status;
    if (s.lifetime) status = `<span class="pill ok">${esc(t('planLifetime'))}</span>`;
    else if (s.allowed) status = `<span class="pill ${days != null && days <= 7 ? 'warn' : 'ok'}">${esc(t('planActive'))}</span>`;
    else if (s.graceUntil) status = `<span class="pill warn">${esc(t('planGrace'))}</span>`;
    else status = `<span class="pill bad">${esc(t('planEnded'))}</span>`;
    const row = (k, v) => `<div class="item"><div class="grow muted">${esc(k)}</div><b>${v}</b></div>`;
    const yes = (on) => (on ? `✅ ${esc(t('planYes'))}` : `— ${esc(t('planNo'))}`);
    const end = s.lifetime ? esc(t('lifetime')) : s.expires ? esc(dateStr(s.expires)) : '—';
    const left = !s.lifetime && days != null && days > 0 ? esc(t('planDaysLeft', { n: days })) : '';
    const grace = s.graceUntil ? `<div class="warnbox" style="margin-top:10px">${ic('alert')}<div class="grow">${esc(t('planGraceHint', { d: dateStr(s.graceUntil) }))}</div></div>` : '';
    const ask = `<button class="btn ${s.contactUrl ? '' : 'primary'}" data-renew="${esc(g.id)}">${ic('mega')} ${esc(t('planAsk'))}</button>`;
    const renew = `<div class="row" style="gap:8px;flex-wrap:wrap">${ask}${s.contactUrl ? `<a class="btn primary" href="${esc(s.contactUrl)}" target="_blank" rel="noopener">${esc(t('planRenew'))}</a>` : ''}</div>`;
    return `<div class="grid g2" style="align-items:start">
      <div class="card"><h3>${ic('shield')} ${esc(t('tabPlan'))} ${status}</h3>
        <div class="list">${row(t('planEnds'), `${end}${left ? ` · ${left}` : ''}`)}${row(t('subMusic'), yes(s.music))}${row(t('subBridge'), yes(s.bridge))}${row(t('planRoomBots'), s.slaves ? String(s.maxSlaves || 0) : `— ${esc(t('planNo'))}`)}${row(t('subWebListen'), yes(s.webListen))}</div>${grace}</div>
      <div class="card"><h3>${ic('clock')} ${esc(t('planRenewTitle'))}</h3><div class="muted" style="margin-bottom:12px">${esc(t('planRenewHint'))}</div>${renew}</div>
    </div>`;
  }

  function subTab(g) {
    const s = g.subscription;
    const id = esc(g.id);
    if (!s.exists) {
      return `<div class="card"><h3>${ic('plus')} ${esc(t('addSub'))}</h3>
        <div class="grid g2"><label class="field">${esc(t('label'))}<input class="input" id="sub-label" value="${esc(g.name)}"></label>
        <label class="field">${esc(t('expires'))}<input class="input" type="date" id="sub-exp"></label></div>
        <div class="row" style="margin-top:12px"><label class="row"><label class="switch"><input type="checkbox" id="sub-life" checked><span></span></label>${esc(t('subLifetime'))}</label><div class="grow"></div><button class="btn primary" data-subadd="${id}">${ic('check')} ${esc(t('addSub'))}</button></div></div>`;
    }
    const tg = (field, title) => `<div class="toggle"><div class="txt"><b>${esc(title)}</b></div><label class="switch"><input type="checkbox" data-subtoggle="${field}" ${s[field] ? 'checked' : ''}><span></span></label></div>`;
    return `<div class="grid g2" style="align-items:start">
      <div class="card"><h3>${ic('shield')} ${esc(t('tabSub'))} ${subBadge(s)}</h3>
        ${tg('active', t('subActive'))}${tg('music', t('subMusic'))}${tg('bridge', t('subBridge'))}${tg('slaves', t('subSlaves'))}${tg('autoRoom', t('subAutoRoom'))}${tg('webListen', t('subWebListen'))}${tg('editSlaveProfile', t('subEditProfile'))}${tg('lifetime', t('subLifetime'))}${tg('labelLocked', t('subLabelLock'))}
      </div>
      <div class="grid">
        <div class="card"><h3>${ic('clock')} ${esc(t('expires'))}</h3>
          <div class="muted" style="margin-bottom:10px">${s.lifetime ? esc(t('lifetime')) : s.expires ? esc(t('expiresOn', { d: dateStr(s.expires) })) : '—'}</div>
          <div class="row"><input class="input" type="date" id="sub-exp" value="${s.expires ? esc(s.expires.slice(0, 10)) : ''}" style="max-width:200px"><button class="btn" data-subsave="expires">${esc(t('save'))}</button></div>
          <div class="row" style="margin-top:10px">${[7, 30, 90, 365].map(d => `<button class="btn sm" data-subextend="${d}">+${d} ${esc(t('day'))}</button>`).join('')}</div>
        </div>
        <div class="card"><div class="grid g2">
          <label class="field">${esc(t('label'))}<input class="input" id="sub-label" value="${esc(s.label || '')}"></label>
          <label class="field">${esc(t('maxSlaves'))}<input class="input" type="number" min="0" max="50" id="sub-max" value="${s.maxSlaves}"></label>
        </div>
          <label class="field" style="margin-top:10px">${esc(t('note'))}<textarea class="input" id="sub-note" style="min-height:70px">${esc(s.note || '')}</textarea></label>
          <div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn primary" data-subsave="meta">${esc(t('save'))}</button></div>
        </div>
        <div class="card"><button class="btn danger" data-subremove="${id}">${ic('trash')} ${esc(t('removeSub'))}</button></div>
      </div></div>`;
  }

  function roomsTab(g) {
    const r = g.rooms.masterResolved || {};
    const opt = (list, sel) => `<option value="">—</option>${list.map(c => `<option value="${esc(c.id)}" ${c.id === sel ? 'selected' : ''}>${c.parent ? `${esc(c.parent)} / ` : ''}${esc(c.name)}</option>`).join('')}`;
    const rb = (s, a, icon, label, cls = '') => `<button class="btn sm ${cls}" data-roombot="${a}" data-name="${esc(s.name)}" title="${esc(label)}">${ic(icon)}<span class="hide-sm"> ${esc(label)}</span></button>`;
    const slaves = g.slaves.map(s => `<tr><td><b>#${esc(s.name)}</b><div class="faint" style="font-size:11.5px">${esc(s.tag)}</div></td><td>${esc(chName(g, s.channelId))}</td><td>${esc(chName(g, s.textChannelId))}</td><td><span class="pill ${s.paused ? 'warn' : s.connStatus === 'ready' ? 'ok' : 'bad'}">${esc(s.paused ? t('pause') : s.connStatus)}</span></td><td><div class="row" style="gap:6px;flex-wrap:nowrap">${s.paused ? rb(s, 'resume', 'play', t('resumeVoice'), 'primary') : rb(s, 'pause', 'pause', t('pauseVoice'))}${s.paused ? '' : rb(s, 'reconnect', 'refresh', t('rejoin'))}</div></td></tr>`).join('');
    const v = g.view || {};
    const card = (k, html) => (v[k] === 'hide' ? '' : roWrap(html, v[k]));
    return `<div class="grid g2" style="align-items:start">
      ${card('rooms', `<div class="card"><h3>${ic('vol')} ${esc(t('master_bot'))}</h3>
        <label class="field">${esc(t('voiceRoom'))}<select class="input" id="room-voice">${opt(g.channels.voice, r.voiceChannelId)}</select></label>
        <label class="field" style="margin-top:10px">${esc(t('textRoom'))}<select class="input" id="room-text">${opt([...g.channels.text, ...g.channels.voice], r.textChannelId)}</select></label>
        <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn primary" data-rooms-save>${esc(t('save'))}</button></div>
      </div>`)}
      ${card('voice', `<div class="card"><h3>${ic('mic')} ${esc(t('voiceCtl'))}</h3>
        <div class="row" style="margin-bottom:12px"><span class="pill ${g.voice.status === 'ready' ? 'ok' : g.voice.paused ? 'warn' : 'bad'}"><span class="dot ${g.voice.status === 'ready' ? 'live' : ''}"></span>${esc(g.voice.status)}</span>${g.voice.bridge ? '<span class="pill gold">bridge</span>' : ''}</div>
        <div class="row">${g.voice.paused ? `<button class="btn primary" data-voice="resume">${ic('play')} ${esc(t('resumeVoice'))}</button>` : `<button class="btn" data-voice="pause">${ic('pause')} ${esc(t('pauseVoice'))}</button>`}<button class="btn" data-voice="rejoin">${ic('refresh')} ${esc(t('rejoin'))}</button></div>
      </div>`)}
      ${g.slaves.length && v.roomBots !== 'hide' ? roWrap(`<div class="card" style="grid-column:1/-1"><h3>${ic('bot')} ${esc(t('slaves'))}</h3><div class="tscroll"><table class="t"><thead><tr><th>#</th><th>${esc(t('voiceRoom'))}</th><th>${esc(t('textRoom'))}</th><th>${esc(t('status'))}</th><th></th></tr></thead><tbody>${slaves}</tbody></table></div></div>`, v.roomBots) : ''}
    </div>`;
  }

  function chName(g, id) {
    if (!id) return '—';
    const c = [...g.channels.voice, ...g.channels.text].find(x => x.id === id);
    return c ? c.name : id;
  }

  // T25b: server-permission editor + test tool (backend: src/web/guildPerms.js, GET/POST /api/guilds/:id/perms).
  const ID_RE = /^\d{17,20}$/;
  const permsSettings = (gid) => S.data.perms?.[gid]?.settings;
  async function permsTab(gid) {
    const p = await api('GET', `/api/guilds/${gid}/perms`);
    S.data.perms = { [gid]: p };
    if (!S.permsDraft || S.permsFor !== gid) { S.permsFor = gid; S.permsDraft = {}; }
    const s = p.settings, d = S.permsDraft, dv = (k) => (d[k] !== undefined ? d[k] : s[k]);
    const chips = (key) => `<div class="pm-chips">${dv(key).map(x => `<span class="pm-chip"><span class="ell" style="max-width:220px" title="${esc(x)}">${esc(S.memberNames?.[x] || p.names?.[x] || x)}</span><button type="button" class="pm-x" data-pdel="${key}" data-pid="${esc(x)}" title="${esc(t('cancel'))}">×</button></span>`).join('')}</div>
      <div class="row" style="gap:8px;align-items:center;margin-bottom:2px;position:relative"><input class="input grow" id="pm-${key}" data-msearch="${esc(gid)}" placeholder="${esc(t('searchMember'))}"><button class="btn sm" type="button" data-padd="${key}">${ic('plus')} ${esc(t('add'))}</button></div>
      <div class="pm-err" id="pm-${key}-err"></div>`;
    const roleRows = (p.roles || []).map(r => `<label class="row" style="justify-content:flex-start;gap:8px;padding:2.5px 0;font-size:13px;cursor:pointer"><input type="checkbox" data-pcheck="role" data-pid="${esc(r.id)}" ${dv('djRoleIds').includes(r.id) ? 'checked' : ''} style="margin:0"><span class="colordot" style="${r.color ? `background:${esc(r.color)}` : 'background:var(--faint)'}"></span><span class="ell">${esc(r.name)}</span></label>`).join('') || '<span class="faint" style="font-size:12.5px">—</span>';
    const tog = (k, label, hint) => `<div class="toggle"><div class="txt"><b>${esc(label)}</b>${hint ? `<span>${esc(hint)}</span>` : ''}</div><label class="switch"><input type="checkbox" data-pcheck="${k}" ${dv(k) ? 'checked' : ''}><span></span></label></div>`;
    const lvlRow = (l, extra = '', bad = false) => `<div class="pm-lvl"><span class="pill ${bad ? 'bad' : ''}">${esc(t('lvl_' + l))}</span>${extra ? `<span style="font-size:12px;color:var(--muted)">${esc(extra)}</span>` : ''}</div>`;
    return `<div class="grid g2" style="align-items:start">
      <div class="card" style="grid-column:1/-1"><h3>${ic('shield')} ${esc(t('level'))}</h3>${lvlRow('admin', t('lvlD_admin'))}
        ${lvlRow('dj', t('lvlD_dj'))}${lvlRow('roomOwner', t('lvlD_roomOwner'))}${lvlRow('listener', t('lvlD_listener'))}${lvlRow('viewer', t('lvlD_viewer'))}${lvlRow('banned', t('lvlD_banned'), true)}</div>
      <div class="card"><h3>${ic('music')} ${esc(t('lvl_dj'))}</h3>
        <div class="faint" style="font-size:12px;margin-bottom:8px">${esc(t('djRoleHint'))}</div>
        <div class="pm-roles">${roleRows}</div>
        <div class="faint" style="font-size:12px;margin:12px 0 6px">${esc(t('djUsers'))}</div>${chips('djUserIds')}</div>
      <div class="card"><h3>${ic('vol')} ${esc(t('listenersCard'))}</h3>${tog('djOnly', t('djOnly'), t('djOnlyHint'))}${tog('listenerCanAdd', t('listenerCanAdd'))}${tog('listenerVoteSkip', t('listenerVoteSkip'))}${tog('listenerCanPause', t('listenerCanPause'))}${tog('listenerCanVolume', t('listenerCanVolume'))}${tog('allowLinks', t('allowLinks'))}${tog('pauseWhenEmpty', t('pauseWhenEmpty'))}
        <div class="grid g2" style="margin-top:10px">
          <label class="field">${esc(t('playPerMin'))}<input class="input" type="number" min="1" max="30" id="pm-play" value="${dv('playPerMin')}"></label>
          <label class="field">${esc(t('maxTrackMin'))}<input class="input" type="number" min="0" max="600" id="pm-max" value="${dv('maxTrackMin')}"></label>
          <label class="field">${esc(t('maxQueuedPerMember'))}<input class="input" type="number" min="0" max="100" id="pm-mine" value="${dv('maxQueuedPerMember')}"></label>
          <label class="field">${esc(t('listenerMaxVolume'))}<input class="input" type="number" min="10" max="200" step="10" id="pm-vol" value="${dv('listenerMaxVolume')}"></label>
        </div>
      </div>
      <div class="card"><h3>${ic('alert')} ${esc(t('blockedUsers'))}</h3>${chips('bannedUserIds')}</div>
      <div class="card"><h3>${ic('refresh')} ${esc(t('permTest'))}</h3>
        <div class="row" style="gap:8px;align-items:center;position:relative"><input class="input grow" id="pm-test-id" data-msearch="${esc(gid)}" placeholder="${esc(t('searchMember'))}"><button class="btn" type="button" data-ptest>${esc(t('permTest'))}</button></div>
        <div class="pm-err" id="pm-test-err"></div>
        <div id="pm-test-out" style="margin-top:8px"></div>
      </div>
      <div class="row" style="grid-column:1/-1;justify-content:flex-end"><button class="btn primary" type="button" data-psave>${ic('check')} ${esc(t('save'))}</button></div>
    </div>`;
  }

  function dangerTab(g) {
    return `<div class="grid g2">
      <div class="card"><h3>${ic('refresh')} ${esc(t('voiceCtl'))}</h3><div class="row"><button class="btn" data-voice="rejoin">${ic('refresh')} ${esc(t('rejoin'))}</button></div></div>
      ${isOwner() && g.inGuild ? `<div class="card"><h3 style="color:var(--bad)">${ic('alert')} ${esc(t('leaveGuild'))}</h3><p class="muted">${esc(t('leaveWarn'))}</p><button class="btn danger" data-leave="${esc(g.id)}" data-name="${esc(g.name)}">${ic('out')} ${esc(t('leaveGuild'))}</button></div>` : ''}
    </div>`;
  }

  /** "Now": the room you are in (or watching), all controls on demand, recent activity, stats, the server's other bots. */
  const addForm = (key) => `<form class="row" data-form="play" data-key="${esc(key)}" style="margin-top:8px"><input class="input grow" name="query" placeholder="${esc(t('addTrack'))}" autocomplete="off"><button class="btn primary" type="submit">${ic('plus')} ${esc(t('add'))}</button></form>`;
  const lvlPill = (q) => `<span class="pill">${esc(t('lvl_' + (q.my?.level || 'viewer')))}</span>`;
  const ADV = ['volume', 'filter', 'loop', 'autodj', 'remove', 'move', 'moveto', 'jump', 'clear'];

  function nowControls(q) {
    const k = esc(q.key);
    const filters = ['none', 'bass', 'treble', 'eightd', 'wide', 'reverb', 'phone', 'radio', 'nightcore', 'vaporwave', 'slowed'];
    const f = [];
    if (allowed(q, 'volume')) f.push(`<label class="field">${esc(t('volume'))} <span class="mono" data-volv="${k}">${q.volume}%</span><input type="range" min="0" max="200" step="5" value="${q.volume}" data-change="volume" data-key="${k}"></label>`);
    if (allowed(q, 'filter')) f.push(`<label class="field">${esc(t('filter'))}<select class="input" data-change="filter" data-key="${k}">${filters.map(x => `<option value="${x}" ${q.filter === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>`);
    if (allowed(q, 'loop')) f.push(`<label class="field">${esc(t('loopMode'))}<select class="input" data-change="loop" data-key="${k}">${[['none', t('loopNone')], ['queue', t('loopQueue')], ['track', t('loopTrack')]].map(([v, n]) => `<option value="${v}" ${q.loop === v ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>`);
    if (allowed(q, 'autodj')) f.push(`<label class="field">${esc(t('autoDj'))}<div class="row"><label class="switch"><input type="checkbox" data-change="autodj" data-key="${k}" ${q.autoDj ? 'checked' : ''}><span></span></label>${allowed(q, 'autodjmode') ? `<select class="input" data-change="adjmode" data-key="${k}"><option value="similar" ${q.autoDjMode === 'similar' ? 'selected' : ''}>${esc(t('adjSimilar'))}</option><option value="mood" ${q.autoDjMode !== 'similar' ? 'selected' : ''}>${esc(t('adjMood'))}</option></select>` : ''}</div></label>`);
    return f.length ? `<div class="card"><div class="grid g2">${f.join('')}</div></div>` : '';
  }

  function nowQueue(q, full) {
    const k = esc(q.key);
    const tracks = q.tracks || [];
    if (!tracks.length) return '';
    const totalSec = tracks.reduce((a, tr) => a + (tr.durationSec || 0), 0);
    const shown = full || S.nowQAll ? tracks : tracks.slice(0, 5);
    const row = (tr, i) => `<div class="item"><span class="idx">${i + 1}</span><div class="grow" style="min-width:0"><div class="ell">${esc(tr.title)}</div><div class="faint" style="font-size:12px">${tr.durationSec ? fmtDur(tr.durationSec) : ''}${tr.requester?.name ? ` · ${esc(tr.requester.name)}` : ''}</div></div>${full ? `<div class="acts">
        ${allowed(q, 'jump') ? `<button class="btn sm icon ghost" data-q="jump" data-key="${k}" data-index="${i + 1}" title="${esc(t('play'))}">${ic('play')}</button>` : ''}
        ${allowed(q, 'moveto') && i > 0 ? `<button class="btn sm icon ghost" data-q="moveto" data-to="1" data-key="${k}" data-index="${i + 1}" title="${esc(t('toTop'))}">⤒</button>` : ''}
        ${allowed(q, 'move') ? `<button class="btn sm icon ghost" data-q="move" data-dir="up" data-key="${k}" data-index="${i + 1}">${ic('up')}</button><button class="btn sm icon ghost" data-q="move" data-dir="down" data-key="${k}" data-index="${i + 1}">${ic('down')}</button>` : ''}
        ${allowed(q, 'remove') ? `<button class="btn sm icon ghost" data-q="remove" data-key="${k}" data-index="${i + 1}">${ic('trash')}</button>` : ''}
      </div>` : `${tr.durationSec ? '' : ''}`}</div>`;
    const clear = full && allowed(q, 'clear') ? `<button class="btn sm ghost" data-q="clear" data-key="${k}">${ic('trash')} ${esc(t('clear'))}</button>` : '';
    const showAllBtn = !full && tracks.length > 5 ? `<button class="btn sm ghost" style="margin-top:8px;width:100%" data-act="nowqall">${esc(t('showAll'))} (${tracks.length})</button>` : '';
    return `<div class="card"><h3>${ic('layers')} ${esc(t('upNext'))} <span class="muted">${q.length}${totalSec ? ` · ${fmtDur(totalSec)}` : ''}</span><div class="grow"></div>${clear}</h3><div class="list">${shown.map(row).join('')}</div>${showAllBtn}</div>`;
  }

  async function pageNow() {
    const g = S.route.q?.get('g') || '';
    const o = await api('GET', `/api/now${/^\d{17,20}$/.test(g) ? `?g=${g}` : ''}`);
    S.data.now = o;
    S.queues = new Map();
    for (const q of [...(o.room ? [o.room] : []), ...(o.others || []).filter(x => x.current)]) S.queues.set(q.key, q);
    let top;
    if (o.room) {
      const q = o.room;
      const hasAdv = ADV.some(a => allowed(q, a));
      const full = hasAdv && S.nowAll;
      const toggle = hasAdv ? `<button class="btn sm ${full ? 'primary' : 'ghost'}" data-act="nowall">${ic('menu')} ${esc(t(full ? 'lessControls' : 'allControls'))}</button>` : '';
      top = `<div class="now-here">
        <div class="row" style="gap:8px;margin-bottom:8px;min-width:0"><span class="faint">${esc(t(q.here ? 'nowIn' : 'nowWatching'))}</span><b class="ell">${esc(q.channelName || roomName(q))}</b><span class="faint ell" style="font-size:12.5px">· ${esc(q.guildName || '')}</span><span class="grow"></span>${listenBtn(q.guildId, q.guildName)}${q.webListeners ? `<span class="pill" title="${esc(t('webListeners'))}">🎧 ${q.webListeners}</span>` : ''}${lvlPill(q)}${q.my?.level === 'admin' ? `<a class="btn sm ghost icon" href="#/server/${esc(q.guildId)}" title="${esc(t('srvSettings'))}" aria-label="${esc(t('srvSettings'))}">${ic('gear')}</a>` : ''}</div>
        ${playerCard(q, { compact: true })}
        ${allowed(q, 'play') ? addForm(q.key) : ''}
        ${!q.here && !(q.my?.actions || []).length ? `<div class="faint" style="font-size:12.5px;margin:6px 2px">${esc(t('memberJoinHint'))}</div>` : ''}
        <div class="row" style="margin:8px 0;gap:8px;justify-content:flex-end">${toggle}</div>
        ${full ? nowControls(q) : ''}
        ${nowQueue(q, full)}
      </div>`;
    } else {
      const msg = o.inVoice ? `${t('nowNoBot')}${o.inVoice.channelName ? ` (${o.inVoice.channelName} · ${o.inVoice.guildName})` : ''}. ${t('memberJoinHint')}` : t('memberJoinHint');
      top = `<div class="card empty">${ic('now')}<div>${esc(msg)}</div></div>`;
    }
    const act = o.activity;
    const canReplay = !!(o.room && allowed(o.room, 'play'));
    const canNext = canReplay && allowed(o.room, 'moveto');
    const rkey = o.room ? esc(o.room.key) : '';
    const songs = (act?.songs || []).map(tr => {
      const rq = tr.requester && (tr.requester.name || tr.requester);
      const sub = [rq, tr.durationSec ? fmtDur(tr.durationSec) : ''].filter(Boolean).join(' · ');
      const btns = canReplay ? `<div class="acts">${tr.url ? `<button class="btn sm icon ghost" data-act="replay" data-url="${esc(tr.url)}" data-key="${rkey}" title="${esc(t('addToQueue'))}">${ic('play')}</button>` : ''}${canNext && tr.url ? `<button class="btn sm icon ghost" data-act="replay" data-next="1" data-url="${esc(tr.url)}" data-key="${rkey}" title="${esc(t('playNext'))}">⏭</button>` : ''}</div>` : '';
      return `<div class="item">${tr.thumbnail ? `<img class="thumb" src="${esc(tr.thumbnail)}" alt="" loading="lazy">` : '<div class="thumb"></div>'}<div class="grow" style="min-width:0"><div class="ell">${esc(tr.title)}</div>${sub ? `<div class="faint ell" style="font-size:12px">${esc(sub)}</div>` : ''}</div>${tr.playedAt ? `<span class="faint" style="font-size:12px;white-space:nowrap">${esc(ago(Date.parse(tr.playedAt)))}</span>` : ''}${btns}</div>`;
    }).join('');
    const acts = (act?.actions || []).map(e => `<div class="item"><div class="grow ell"><b>${esc(e.user || '?')}</b> <span class="muted">${esc(L[lang]['act_' + e.action] ? t('act_' + e.action) : e.action)}</span></div><span class="faint" style="font-size:12px;white-space:nowrap">${esc(ago(e.ts))}</span></div>`).join('');
    const activity = act ? `<h3 class="sec-h">${ic('clock')} ${esc(t('recentActivity'))}</h3><div${acts ? ' class="grid g2" style="align-items:start"' : ''}>
      <div class="card"><h3>${esc(t('recentSongs'))}</h3><div class="list">${songs || `<div class="faint">${esc(t('noActivity'))}</div>`}</div></div>
      ${acts ? `<div class="card"><h3>${esc(t('recentActions'))}</h3><div class="list">${acts}</div></div>` : ''}</div>` : '';
    const st = o.stats;
    const stats = st && st.plays > 0 ? `<h3 class="sec-h">${ic('wave')} ${esc(t('tabStats'))}${o.guild ? ` <span class="muted ell">${esc(o.guild.name)}</span>` : ''}</h3>
      <div class="grid g2 kpis"><div class="card kpi"><div class="label">${esc(t('todayPlays'))}</div><div class="value">${st.todayPlays}</div></div><div class="card kpi"><div class="label">${esc(t('totalPlays'))}</div><div class="value">${st.plays}</div></div></div>
      ${st.topTracks.length || st.topDjs.length ? `<div class="grid g2" style="align-items:start;margin-top:12px">
        <div class="card"><h3>${esc(t('topSongs'))}</h3><div class="list">${st.topTracks.map((tr, i) => `<div class="item"><span class="idx">${i + 1}</span><div class="grow ell">${esc(tr.title)}</div><span class="pill gold">${tr.count}×</span></div>`).join('')}</div></div>
        <div class="card"><h3>${esc(t('topRequesters'))}</h3><div class="list">${st.topDjs.map((d, i) => `<div class="item"><span class="idx">${i + 1}</span><div class="grow ell">${esc(d.name || '?')}</div><span class="pill">${d.count}</span></div>`).join('')}</div></div>
      </div>` : ''}` : '';
    const bots = (o.others || []).map(q => {
      const status = q.idle ? `<span class="pill ${q.status === 'ready' ? '' : 'bad'}">${esc(q.status === 'ready' ? t('idleBot') : q.status)}</span>` : q.playing ? `<span class="pill ok"><span class="eq"><i></i><i></i><i></i></span>${esc(t('live'))}</span>` : q.paused ? `<span class="pill warn">${esc(t('pause'))}</span>` : `<span class="pill">${esc(t('idleBot'))}</span>`;
      return `<div class="card bot-mini" ${q.current ? `data-live-key="${esc(q.key)}"` : ''}><div class="row" style="gap:8px;min-width:0"><b class="ell">${esc(roomName(q))}</b>${q.channelName ? `<span class="faint ell" style="font-size:12.5px">· ${esc(q.channelName)}</span>` : ''}<span class="grow"></span>${status}</div>
        ${q.current ? `<div class="row" style="gap:8px;margin-top:8px;min-width:0">${q.current.thumbnail ? `<img class="thumb" src="${esc(q.current.thumbnail)}" alt="" loading="lazy">` : ''}<div class="grow" style="min-width:0"><div class="ell" style="font-weight:600">${esc(q.current.title)}</div><div class="faint" style="font-size:12px">${q.listeners ? `${q.listeners} ${esc(t('listeners'))}` : ''}${q.roomOwnerName ? ` · 👑 ${esc(q.roomOwnerName)}` : ''}</div></div>${q.my ? lvlPill(q) : ''}</div>` : ''}</div>`;
    }).join('');
    const others = bots ? `<h3 class="sec-h">${ic('bot')} ${esc(t('otherBots'))} <span class="muted">${o.others.length}</span></h3><div class="grid auto">${bots}</div>` : '';
    const away = (o.elsewhere || []).map(x => `<a class="card bot-mini" style="color:inherit" href="#/now?g=${esc(x.guildId)}"><div class="row" style="gap:8px;min-width:0">${x.icon ? `<img class="gicon" style="width:28px;height:28px" src="${esc(x.icon)}" alt="">` : `<div class="gicon" style="width:28px;height:28px">${initials(x.guildName)}</div>`}<b class="ell">${esc(x.channelName || '')}</b><span class="faint ell" style="font-size:12.5px">· ${esc(x.guildName)}</span><span class="grow"></span><span class="pill ok"><span class="eq"><i></i><i></i><i></i></span>${esc(t('live'))}</span></div><div class="ell" style="margin-top:6px;font-weight:600">${esc(x.title || '')}</div></a>`).join('');
    const elsewhere = away ? `<h3 class="sec-h">${ic('server')} ${esc(t('nowElsewhere'))}</h3><div class="grid auto">${away}</div>` : '';
    return `${header(esc(t('now')))}${top}${activity}${stats}${others}${elsewhere}`;
  }

  /** Servers page for server admins and members: every server you share with the bot, your level, open = Now for that server. */
  async function pageMyServers() {
    const o = await api('GET', '/api/now');
    const servers = o.servers || [];
    const cards = servers.map(g => `<div class="card srv-mini"><div class="ghead"><a class="row grow" style="gap:12px;min-width:0;color:inherit" href="#/now?g=${esc(g.id)}">${g.icon ? `<img class="gicon" src="${esc(g.icon)}" alt="">` : `<div class="gicon">${initials(g.name)}</div>`}<div class="grow" style="min-width:0"><b class="ell" style="display:block">${esc(g.name)}</b><span class="row" style="gap:6px;margin-top:4px"><span class="pill ${g.level === 'admin' ? 'warn' : ''}">${esc(g.level === 'viewer' ? t('roleMember') : t('lvl_' + g.level))}</span>${g.playing ? `<span class="pill ok"><span class="eq"><i></i><i></i><i></i></span>${g.playing}</span>` : ''}</span></div></a>${g.settings ? `<a class="btn sm ghost icon" href="#/server/${esc(g.id)}" title="${esc(t('srvSettings'))}" aria-label="${esc(t('srvSettings'))}">${ic('gear')}</a>` : ''}</div></div>`).join('');
    return `${header(esc(t('myServers')), `${servers.length}`)}${servers.length ? `<div class="grid auto">${cards}</div>` : `<div class="card empty">${ic('server')}<div>${esc(t('memberNoGuilds'))}</div></div>`}`;
  }

  async function pageBots() {
    const b = await api('GET', '/api/bots');
    const card = (x, title) => `<div class="card"><div class="ghead">${x.avatar ? `<img class="gicon" src="${esc(x.avatar)}" alt="">` : `<div class="gicon">${initials(x.tag)}</div>`}<div class="grow" style="min-width:0"><b class="ell" style="display:block">${esc(x.tag)}</b><span class="faint" style="font-size:12px">${esc(title)}</span></div><span class="pill ${x.ping != null ? 'ok' : 'bad'}">${x.ping ?? '—'} ms</span></div>
      <div class="chips" style="margin-top:12px"><span class="pill">${x.guilds} ${esc(t('guilds'))}</span>${(x.deployments || []).map(d => `<span class="pill ${d.voice === 'ready' ? 'ok' : 'bad'}" title="${esc(d.guildId)}">#${esc(d.name)} · ${esc(guildName(d.guildId))}</span>`).join('')}</div></div>`;
    const pool = b.pool.length ? `<div class="card"><h3>${ic('layers')} ${esc(t('pool'))} <span class="muted">${b.pool.length}</span></h3><table class="t"><tbody>${b.pool.map(p => `<tr><td><b>${esc(p.label)}</b></td><td class="mono faint">${esc(p.clientId || '')}</td><td>${p.inviteUrl ? `<button class="btn sm ghost" data-copy="${esc(p.inviteUrl)}">${ic('copy')} ${esc(t('invite'))}</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '';
    return `${header(esc(t('bots')), `${1 + b.slaves.length}`)}<div class="grid"><div class="grid auto">${b.master ? card(b.master, t('master_bot')) : ''}${b.slaves.map(s => card(s, t('slave'))).join('')}</div>${pool}</div>`;
  }

  function guildName(id) {
    const g = (S.data.guilds || []).find(x => x.id === id);
    return g?.name || id;
  }

  async function pageLogs() {
    const lv = S.logLevel;
    const rows = await api('GET', `/api/logs?limit=1500${lv ? `&level=${lv}` : ''}${S.logQuery ? `&q=${encodeURIComponent(S.logQuery)}` : ''}`);
    S.logs = rows;
    const filt = [['', t('all')], ['warn', 'warn+'], ['error', 'error']].map(([k, n]) => `<button class="${lv === k ? 'on' : ''}" data-loglevel="${k}">${esc(n)}</button>`).join('');
    return `${header(esc(t('logs')), `${rows.length}`, `<button class="btn sm" data-act="logpause">${ic(S.logsPaused ? 'play' : 'pause')} ${esc(S.logsPaused ? t('resumeLive') : t('pauseLive'))}</button>`)}
      <div class="row" style="margin-bottom:12px"><input class="input" style="max-width:340px" placeholder="${esc(t('search'))}" value="${esc(S.logQuery)}" data-logq><div class="filters">${filt}</div></div>
      <div class="logs" id="logs">${rows.map(logLine).join('')}</div>`;
  }

  function logLine(e) {
    const ts = new Date(e.ts).toISOString().slice(11, 19);
    const txt = esc(e.text.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s*/, ''));
    return `<div class="l ${e.level}"><span class="ts">${ts}</span>${txt.replace(/^\[([^\]]+)\]/, '<span class="tag">[$1]</span>')}</div>`;
  }

  function appendLog(e) {
    const box = $('#logs');
    if (!box) return;
    if (S.logLevel === 'error' && e.level !== 'error') return;
    if (S.logLevel === 'warn' && e.level === 'info') return;
    if (S.logQuery && !e.text.toLowerCase().includes(S.logQuery.toLowerCase())) return;
    const stick = box.scrollTop + box.clientHeight >= box.scrollHeight - 30;
    box.insertAdjacentHTML('beforeend', logLine(e));
    while (box.childElementCount > 2000) box.firstElementChild.remove();
    if (stick) box.scrollTop = box.scrollHeight;
  }

  // T54: Discord-flavoured markdown preview (escape first, then a safe subset).
  function mdPreview(src) {
    let h = esc(String(src || ''));
    const blocks = [];
    h = h.replace(/```(?:[a-z0-9]*\n)?([\s\S]*?)```/g, (_, c) => { blocks.push(`<pre class="md-pre">${c}</pre>`); return `@@B${blocks.length - 1}@@`; });
    h = h.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    h = h.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/__([^_]+)__/g, '<u>$1</u>').replace(/\*([^*\n]+)\*/g, '<i>$1</i>').replace(/~~([^~]+)~~/g, '<s>$1</s>').replace(/\|\|([^|]+)\|\|/g, '<span class="md-spoil">$1</span>');
    h = h.replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '<span class="md-link">$1</span>');
    h = h.replace(/(^|\s)@(everyone|here)\b/g, '$1<span class="md-mention">@$2</span>').replace(/&lt;@[&amp;!]*(\d{17,20})&gt;/g, '<span class="md-mention">@$1</span>').replace(/&lt;#(\d{17,20})&gt;/g, '<span class="md-mention">#$1</span>');
    h = h.split('\n').map(line => {
      let m;
      if ((m = line.match(/^(#{1,3}) (.*)$/))) return `<div class="md-h${m[1].length}">${m[2]}</div>`;
      if ((m = line.match(/^-# (.*)$/))) return `<div class="md-sub">${m[1]}</div>`;
      if ((m = line.match(/^&gt; ?(.*)$/))) return `<div class="md-quote">${m[1] || '&nbsp;'}</div>`;
      if ((m = line.match(/^\s*[-*] (.*)$/))) return `<div class="md-li">• ${m[1]}</div>`;
      return `<div>${line || '&nbsp;'}</div>`;
    }).join('');
    return h.replace(/@@B(\d+)@@/g, (_, n) => blocks[+n]);
  }
  const bcState = () => (S.bc = S.bc || { target: 'active', guildId: '', mode: 'one', mentions: false, msg: '', msgEn: '', en: false, preview: null, exclude: [], loading: false });
  const bcBody = () => { const b = bcState(); return { target: b.target === 'one' ? 'all' : b.target, guildId: b.target === 'one' ? b.guildId : null, mode: b.mode, mentions: b.mentions, exclude: b.exclude, message: b.msg, messageEn: b.en ? b.msgEn : '' }; };
  async function bcLoadPreview() {
    const b = bcState();
    if (b.target === 'one' && !b.guildId) { b.preview = null; return; }
    b.loading = true;
    try { b.preview = await api('POST', '/api/broadcast', { ...bcBody(), action: 'preview' }); } catch (err) { toast(`${t('failed')}: ${err.message}`, 'bad'); b.preview = null; }
    b.loading = false;
  }
  const bidiAt = (txt) => esc(txt).replace(/@(everyone|here)/g, '<bdi dir="ltr">@$1</bdi>');
  function bcMentionWarn() {
    const b = bcState();
    const w = $('#bc-mwarn');
    if (w) w.hidden = b.mentions || !/(^|\s)@(everyone|here)\b/.test(`${b.msg}\n${b.en ? b.msgEn : ''}`);
  }
  function bcRecipients() {
    const b = bcState();
    const p = b.preview;
    if (b.target === 'one' && !b.guildId) return `<div class="faint">${esc(t('bcPickServer'))}</div>`;
    if (!p) return `<div class="faint">${esc(t('bcLoading'))}</div>`;
    const nSkip = p.items.filter(i => i.skip).length;
    const sum = (p.kind === 'owners' ? t('bcSumOwners', { m: p.messages, s: p.servers }) : t('bcSum', { s: p.servers, m: p.messages })) + (nSkip ? ` · ${t('bcSumSkip', { k: nSkip })}` : '');
    const rows = p.items.map(i => {
      const sub = i.skip ? `<span class="pill bad">${esc(t('bcSkip_' + i.skip))}</span>`
        : p.kind === 'owners' ? `${esc(i.ownerTag || '')}${i.guildCount > 1 ? ` · ${esc(t('bcGuilds', { n: i.guildCount }))}` : ''}`
          : i.channels.map(c => `#${esc(c.channelName || '?')} <span class="faint">(${esc(c.botKey === 'master' ? t('bcMain') : c.botKey)})</span>`).join(' · ');
      const lang = b.en && !i.skip ? `<div class="bc-lang"><button class="${i.lang !== 'en' ? 'on' : ''}" data-act="bclang" data-gid="${esc(i.guildId)}" data-lang="ar">${esc(t('bcLangAr'))}</button><button class="${i.lang === 'en' ? 'on' : ''}" data-act="bclang" data-gid="${esc(i.guildId)}" data-lang="en">${esc(t('bcLangEn'))}</button></div>` : '';
      const lock = b.target === 'one' || i.skip;
      return `<div class="item bc-row${i.excluded || i.skip ? ' off' : ''}"><input type="checkbox" class="bc-x" data-bcx="${esc(i.guildId)}" ${i.excluded || i.skip ? '' : 'checked'} ${lock ? 'disabled' : ''}><div class="grow" style="min-width:0"><b class="ell" style="display:block">${esc(i.guildName)}</b><div class="faint bc-sub">${sub}</div></div>${lang}</div>`;
    }).join('');
    return `<div class="bc-sum"><b>${esc(sum)}</b></div>${rows ? `<div class="list">${rows}</div>` : `<div class="faint">${esc(t('bcNone'))}</div>`}`;
  }
  function bcHistoryCard(h) {
    const label = (r) => r.target === 'one' ? `${t('tOne')}: ${guildName(r.guildId)}` : t({ active: 'tActive', active_master: 'tActiveMaster', all: 'tAll', inactive: 'tInactive', expired: 'tExpired', owners: 'tOwners' }[r.target] || 'tAll');
    const reason = (c) => (L[lang]['bcr_' + c] ? t('bcr_' + c) : c);
    const rows = (h.history || []).map(r => {
      const ents = r.entries || [];
      const lines = [...ents.filter(e => !e.ok), ...ents.filter(e => e.ok)].map(e => `<div class="bc-ent ${e.ok ? 'ok' : 'bad'}">${e.ok ? '✓' : '✗'} <b>${esc(e.guildName || e.guildId)}</b>${e.channelName ? ` <span class="faint">#${esc(e.channelName)}</span>` : ''}${e.ownerTag ? ` <span class="faint">${esc(e.ownerTag)}</span>` : ''}${e.ok ? '' : ` — <span>${esc(reason(e.reason))}</span>`}</div>`).join('')
        + (r.skipped || []).map(e => `<div class="bc-ent faint">– <b>${esc(e.guildName || e.guildId)}</b> — ${esc(t('bcSkipped'))}: ${esc(L[lang]['bcSkip_' + e.reason] ? t('bcSkip_' + e.reason) : e.reason)}</div>`).join('');
      return `<details class="aud bc-h"><summary><span class="aud-act">${esc(label(r))}</span><span class="faint aud-meta">${esc(ago(r.ts))}${r.by ? ` · ${esc(t('bcBy'))} ${esc(r.by)}` : ''}</span><span class="aud-sum"><span class="pill ok">✓ ${Number(r.ok) || 0}</span>${r.fail ? ` <span class="pill bad">✗ ${Number(r.fail)}</span>` : ''}${r.mentions ? ` <span class="pill warn">${esc(t('bcMentionPill'))}</span>` : ''}</span></summary>
        <div class="bc-msg md">${mdPreview(r.message)}</div>${r.messageEn ? `<div class="faint" style="font-size:12px;margin-top:8px">${esc(t('bcTextEn'))}</div><div class="bc-msg md" dir="ltr">${mdPreview(r.messageEn)}</div>` : ''}
        <div class="bc-ents">${lines}</div>${r.fail ? `<button class="btn sm" data-act="bcretry" data-id="${esc(r.id)}" style="margin-top:8px">${esc(t('bcRetry'))}</button>` : ''}</details>`;
    }).join('');
    return `<div class="card" style="margin-top:12px"><h3>${ic('mega')} ${esc(t('bcHistory'))}</h3>${rows || `<div class="faint">${esc(t('bcNoHistory'))}</div>`}</div>`;
  }
  async function pageBroadcast() {
    const b = bcState();
    const [h] = await Promise.all([api('GET', '/api/broadcasts').then(r => { S.bcTpl = r.templates || []; return r; }).catch(() => ({ history: [] })), b.preview ? null : bcLoadPreview(), S.data.guilds ? null : api('GET', '/api/guilds').then(l => { S.data.guilds = l; }).catch(() => {})]);
    const targets = [['active', t('tActive')], ['active_master', t('tActiveMaster')], ['all', t('tAll')], ['inactive', t('tInactive')], ['expired', t('tExpired')], ['owners', t('tOwners')], ['one', t('tOne')]];
    const guilds = (S.data.guilds || []).slice().sort((x, y) => (y.inGuild !== false) - (x.inGuild !== false) || String(x.name).localeCompare(String(y.name)));
    const counter = (v) => `<span class="faint bc-count${v.length > 2000 ? ' bad' : ''}">${esc(t('bcChars', { n: v.length }))}</span>`;
    return `${header(esc(t('broadcast')))}
      <div class="grid g2" style="align-items:start"><div class="card">
        <label class="field">${esc(t('target'))}<select class="input" id="bc-target">${targets.map(([v, n]) => `<option value="${v}" ${b.target === v ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
        ${b.target === 'one' ? `<label class="field" style="margin-top:10px">${esc(t('bcServer'))}<select class="input" id="bc-guild"><option value="">—</option>${guilds.map(g => `<option value="${esc(g.id)}" ${b.guildId === g.id ? 'selected' : ''}>${esc(g.name)}${g.inGuild === false ? ` (${esc(t('bcNotIn'))})` : ''}</option>`).join('')}</select></label>` : ''}
        ${b.target !== 'owners' ? `<div class="filters" style="margin-top:12px"><button class="${b.mode === 'one' ? 'on' : ''}" data-act="bcmode" data-mode="one">${esc(t('bcModeOne'))}</button><button class="${b.mode === 'all' ? 'on' : ''}" data-act="bcmode" data-mode="all">${esc(t('bcModeAll'))}</button></div>` : ''}
        <div class="row bc-opt"><label class="switch"><input type="checkbox" id="bc-mentions" ${b.mentions ? 'checked' : ''}><span></span></label><div class="grow" style="min-width:0"><div>${bidiAt(t('bcMentions'))}</div><div class="faint" style="font-size:12px">${bidiAt(t(b.mentions ? 'bcMentionsOn' : 'bcMentionsOff'))}</div></div></div>
        <label class="field" style="margin-top:12px"><span class="row" style="gap:8px"><span class="grow">${esc(t(b.en ? 'bcMsgAr' : 'message'))}</span>${counter(b.msg)}</span><textarea class="input" id="bc-msg" maxlength="2000" rows="5" placeholder="**Markdown** ✓">${esc(b.msg)}</textarea></label>
        <div class="bc-pv"><div class="faint" style="font-size:12px">${esc(t('bcPreview'))}</div><div class="md" id="bc-pv-ar">${mdPreview(b.msg)}</div></div>
        <div class="row bc-opt"><label class="switch"><input type="checkbox" id="bc-en" ${b.en ? 'checked' : ''}><span></span></label><div class="grow" style="min-width:0"><div>${esc(t('bcEn'))}</div><div class="faint" style="font-size:12px">${esc(t('bcEnHint'))}</div></div></div>
        ${b.en ? `<label class="field" style="margin-top:10px"><span class="row" style="gap:8px"><span class="grow">${esc(t('bcMsgEn'))}</span>${counter(b.msgEn)}</span><textarea class="input" id="bc-msg-en" dir="ltr" maxlength="2000" rows="5">${esc(b.msgEn)}</textarea></label>
        <div class="bc-pv"><div class="faint" style="font-size:12px">${esc(t('bcPreview'))}</div><div class="md" id="bc-pv-en" dir="ltr">${mdPreview(b.msgEn)}</div></div>` : ''}
        <div class="warnbox" id="bc-mwarn" style="margin-top:10px" hidden>${ic('alert')}<div>${bidiAt(t('bcMentionWarn'))}</div></div>
        <div class="row" style="margin-top:12px;gap:8px;flex-wrap:wrap">${(h.templates || []).length ? `<select class="input" id="bc-tpl" style="flex:1 1 140px;min-width:0"><option value="">${esc(t('bcTplPick'))}</option>${h.templates.map(x => `<option value="${esc(x.name)}">${esc(x.name)}</option>`).join('')}</select><button class="btn sm ghost" data-act="bc-tpldel" title="${esc(t('bcTplDel'))}">${ic('trash')}</button>` : ''}<button class="btn sm" data-act="bc-tplsave">${ic('plus')} ${esc(t('bcTplSave'))}</button></div>
        <div class="row" style="margin-top:12px;gap:8px;flex-wrap:wrap"><input class="input" type="datetime-local" id="bc-at" style="flex:1 1 180px;min-width:0" aria-label="${esc(t('bcAt'))}"><button class="btn" data-act="bc-schedule">${ic('clock')} ${esc(t('bcSchedule'))}</button><div class="grow"></div><button class="btn primary" data-act="bc-send">${ic('mega')} ${esc(t('send'))}</button></div>
      </div><div class="card" id="bc-result"><h3>${ic('server')} ${esc(t('bcRecipients'))}</h3><div id="bc-recip">${bcRecipients()}</div></div></div>
      ${bcScheduledCard(h)}${bcHistoryCard(h)}`;
  }

  // T76: broadcasts waiting for their time.
  function bcScheduledCard(h) {
    const list = h.scheduled || [];
    if (!list.length) return '';
    const when = (iso) => new Date(iso).toLocaleString(lang === 'ar' ? 'ar-SA-u-ca-gregory' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });
    const rows = list.map(x => `<div class="item"><div class="grow" style="min-width:0"><b>${esc(when(x.at))}</b><div class="faint ell" style="font-size:12px">${esc(String(x.draft?.message || '').slice(0, 120))}</div></div><button class="btn sm danger" data-act="bc-unschedule" data-id="${esc(x.id)}">${esc(t('cancel'))}</button></div>`).join('');
    return `<div class="card" style="margin-top:12px"><h3>${ic('clock')} ${esc(t('bcScheduled'))} <span class="muted">${list.length}</span></h3><div class="list">${rows}</div></div>`;
  }

  // T82: support tickets (complaints, suggestions, problems, questions). Staff see all, others their own.
  async function pageSupport() {
    const id = S.route.params.id;
    if (id) return supportTicket(id);
    const st = S.tFilter || '';
    const r = await api('GET', `/api/support${st ? `?status=${st}` : ''}`);
    const kinds = r.kinds || [];
    const kindOpt = kinds.map(k => `<option value="${k}">${esc(t('tk_' + k))}</option>`).join('');
    const gOpt = (r.guilds || []).map(g => `<option value="${esc(g.id)}">${esc(g.name)}</option>`).join('');
    const pillOf = (x) => `<span class="pill ${x.status === 'open' ? 'warn' : x.status === 'answered' ? 'ok' : ''}">${esc(t('ts_' + x.status))}</span>`;
    const rows = r.tickets.map(x => {
      const unread = r.staff ? x.unreadStaff : x.unreadUser;
      return `<a class="item tk-row" href="#/support/${x.id}"><div class="grow" style="min-width:0"><div class="row" style="gap:6px;flex-wrap:wrap"><span class="mono faint">#${x.id}</span><b class="ell" style="max-width:100%">${esc(x.title)}</b>${unread ? `<span class="pill gold">${esc(t('tNew'))}</span>` : ''}</div>
        <div class="faint ell" style="font-size:12px;margin-top:2px">${esc(t('tk_' + x.kind))}${r.staff && x.userName ? ` · ${esc(x.userName)}` : ''}${x.guildName ? ` · ${esc(x.guildName)}` : ''} · ${esc(ago(x.updated))}</div></div>${pillOf(x)}</a>`;
    }).join('');
    const filt = [['', t('all')], ['open', t('ts_open')], ['answered', t('ts_answered')], ['closed', t('ts_closed')]].map(([k, n]) => `<button class="${st === k ? 'on' : ''}" data-act="tfilter" data-st="${k}">${esc(n)}</button>`).join('');
    const form = `<div class="card"><h3>${ic('plus')} ${esc(t('newTicket'))}</h3>
      <form class="grid" data-form="ticket">
        <div class="grid g2" style="gap:10px"><label class="field">${esc(t('tKind'))}<select class="input" name="kind">${kindOpt}</select></label>
        <label class="field">${esc(t('tServer'))}<select class="input" name="guildId"><option value="">${esc(t('tNoServer'))}</option>${gOpt}</select></label></div>
        <label class="field">${esc(t('tTitle'))}<input class="input" name="title" maxlength="100" minlength="3" required></label>
        <label class="field">${esc(t('tText'))}<textarea class="input" name="text" rows="5" maxlength="2000" minlength="5" required></textarea></label>
        <div class="row" style="gap:8px"><span class="faint grow" style="font-size:12px">${esc(t('tLimits'))}</span><button class="btn primary" type="submit">${ic('mega')} ${esc(t('send'))}</button></div>
      </form></div>`;
    const list = `<div class="card"><h3>${ic('chat')} ${esc(t(r.staff ? 'allTickets' : 'myTickets'))} <span class="muted">${r.tickets.length}</span></h3><div class="filters" style="margin-bottom:8px">${filt}</div><div class="list">${rows || `<div class="faint">${esc(t('tNone'))}</div>`}</div></div>`;
    return `${header(esc(t('support')), esc(t(r.staff ? 'supportSubStaff' : 'supportSub')))}<div class="grid g2" style="align-items:start">${r.staff ? list + form : form + list}</div>`;
  }

  async function supportTicket(id) {
    const r = await api('GET', `/api/support/${encodeURIComponent(id)}`);
    const x = r.ticket;
    const when = (ts) => new Date(ts).toLocaleString(lang === 'ar' ? 'ar-SA-u-ca-gregory' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });
    const msgs = x.messages.map(m => `<div class="tk-msg${m.staff ? ' staff' : ''}"><div class="tk-by"><b>${esc(m.staff ? `${t('tStaff')}${r.staff && m.name ? ` · ${m.name}` : ''}` : (m.name || t('unknownUser')))}</b><span class="faint">${esc(when(m.ts))}</span></div><div class="tk-text">${esc(m.text)}</div></div>`).join('');
    const closed = x.status === 'closed';
    const reply = closed && !r.staff
      ? `<div class="faint" style="font-size:13px">${esc(t('tClosedNote'))}</div>`
      : `<form class="grid" data-form="treply" data-id="${x.id}"><label class="field">${esc(t('tReply'))}<textarea class="input" name="text" rows="4" maxlength="2000" required></textarea></label><div class="row" style="justify-content:flex-end"><button class="btn primary" type="submit">${ic('mega')} ${esc(t('send'))}</button></div></form>`;
    const btn = closed
      ? `<button class="btn sm" data-act="treopen" data-id="${x.id}">${ic('refresh')} ${esc(t('tReopen'))}</button>`
      : `<button class="btn sm ghost" data-act="tclose" data-id="${x.id}">${ic('x')} ${esc(t('tClose'))}</button>`;
    const sub = `<span class="mono">#${x.id}</span> · ${esc(t('tk_' + x.kind))} · ${esc(t('ts_' + x.status))}${r.staff && x.userName ? ` · ${esc(x.userName)}${x.userId ? ` <span class="mono faint">${esc(x.userId)}</span>` : ''}` : ''}${x.guildName ? ` · ${esc(x.guildName)}` : ''}`;
    return `${header(`<a href="#/support" class="faint">${esc(t('support'))}</a> / ${esc(x.title)}`, sub, btn)}
      <div class="card"><div class="tk-thread">${msgs}</div><div style="margin-top:14px">${reply}</div></div>`;
  }

  async function pageSecurity() {
    const own = isOwner();
    const [ad, bk, au, rs] = await Promise.all([api('GET', '/api/admins'), api('GET', '/api/backups'), api('GET', '/api/audit'), own ? api('GET', '/api/restore').catch(() => null) : null]);
    const nameOf = (u) => esc(ad.userNames?.[u] && ad.userNames[u] !== u ? ad.userNames[u] : t('unknownUser'));
    const groups = new Map();
    for (const s of ad.sessions) { const k = s.userId || s.name || '?'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(s); }
    const sessions = [...groups.entries()].map(([k, list]) => {
      list.sort((a, b) => b.lastSeen - a.lastSeen);
      const mine = list.some(s => s.id === S.me.sessionId);
      const open = S.sessOpen === k;
      const devs = list.length === 1 ? t('dev1') : list.length === 2 ? t('dev2') : t(list.length <= 10 ? 'devN' : 'devMany', { n: list.length });
      const rows = open ? `<div class="sess-devs">${list.map(s => `<div class="item"><div class="grow" style="min-width:0"><div class="mono faint sess-ip">${esc(s.ip || '—').replace(/:/g, ':<wbr>')}</div><div class="faint" style="font-size:12px">${esc(ago(s.lastSeen))}</div></div>${s.id === S.me.sessionId ? `<span class="pill ok">${esc(t('thisDevice'))}</span>` : `<button class="btn sm ghost" data-act="revokesess" data-sid="${esc(s.id)}">${esc(t('logout'))}</button>`}</div>`).join('')}</div>` : '';
      return `<div class="sess"><div class="item sess-h" data-act="sessopen" data-k="${esc(k)}"><div class="grow" style="min-width:0"><div class="row" style="gap:6px;flex-wrap:wrap"><b class="ell" style="max-width:100%">${esc(list[0].name || t('unknownUser'))}</b><span class="pill">${esc(list[0].role)}</span>${mine ? `<span class="pill ok">${esc(t('you'))}</span>` : ''}</div><div class="faint" style="font-size:12px;margin-top:2px">${esc(devs)} · ${esc(ago(list[0].lastSeen))}</div></div>${mine ? '' : `<button class="btn sm ghost" data-act="revokeuser" data-uid="${esc(list[0].userId || '')}">${esc(t('logout'))}</button>`}<span class="sess-chev${open ? ' open' : ''}">${ic('down')}</span></div>${rows}</div>`;
    }).join('');
    const admins = ad.users.map(u => `<div class="item"><div class="grow" style="min-width:0"><b class="ell" style="display:block">${nameOf(u)}</b><span class="mono faint" style="font-size:12px">${esc(u)}</span></div><button class="btn sm ghost" data-admin-remove="${esc(u)}">${ic('trash')}</button></div>`).join('');
    // T78: each manager can be limited to some servers (none ticked = every server).
    const scopeGuilds = (ad.adminGuild?.options || []);
    const managers = (ad.managers || []).map(u => {
      const sc = ad.managerScopes?.[u] || [];
      const boxes = scopeGuilds.map(g => `<label class="row" style="gap:8px;font-size:13px"><input type="checkbox" data-mscope="${esc(u)}" value="${esc(g.id)}" ${sc.includes(g.id) ? 'checked' : ''}><span class="ell">${esc(g.name)}</span></label>`).join('');
      return `<div class="item" style="flex-wrap:wrap"><div class="grow" style="min-width:0"><b class="ell" style="display:block">${nameOf(u)}</b><span class="mono faint" style="font-size:12px">${esc(u)}</span> <span class="pill">${esc(sc.length ? t('mgrScoped', { n: sc.length }) : t('mgrAll'))}</span></div><button class="btn sm ghost" data-manager-remove="${esc(u)}">${ic('trash')}</button>
        <details style="flex-basis:100%;margin-top:6px"><summary class="faint" style="font-size:12px;cursor:pointer">${esc(t('mgrScopeEdit'))}</summary><div class="grid" style="gap:4px;margin-top:6px;max-height:220px;overflow:auto">${boxes || '<div class="faint">—</div>'}</div><div class="row" style="justify-content:flex-end;margin-top:6px"><button class="btn sm primary" data-act="mscope" data-uid="${esc(u)}">${esc(t('save'))}</button></div></details></div>`;
    }).join('');
    const adminsCard = `<div class="card"><h3>${ic('shield')} ${esc(t('admins'))}</h3><div class="list">${admins || `<div class="faint">—</div>`}</div>
          <form class="row" style="margin-top:10px" data-form="admin"><input class="input grow mono" name="userId" placeholder="${esc(t('addAdmin'))}" inputmode="numeric" pattern="\\d{17,20}" required><button class="btn" type="submit">${ic('plus')}</button></form></div>`;
    const backups = bk.map(b => `<tr><td class="mono">${esc(b.date)}</td><td>${b.files} ${esc(t('files'))}</td><td class="faint">${fmtBytes(b.bytes)}</td>${own ? `<td style="text-align:end"><button class="btn sm ghost" data-act="restore" data-date="${esc(b.date)}">${ic('refresh')} ${esc(t('restore'))}</button></td>` : ''}</tr>`).join('');
    // T82: restore status (waiting for the restart / last one applied).
    const rsLast = rs?.last ? `<div class="faint" style="font-size:12px;margin-top:8px">${esc(t('restoreLast', { d: rs.last.date, n: (rs.last.done || []).length, at: ago(Date.parse(rs.last.appliedAt)) }))}</div>` : '';
    const rsPend = rs?.pending ? `<div class="warnbox" style="margin-top:8px">${ic('clock')}<div class="grow">${esc(t('restorePending', { d: rs.pending.date }))}</div><button class="btn sm ghost" data-act="restorecancel">${esc(t('cancel'))}</button></div>` : '';
    // Audit: short list (10, "show more" +20), filter by group, one line per entry; tap to see full details.
    const audGroup = (a) => { const p = String(a.action || '').split('.')[0]; return p === 'subscription' ? 'sub' : (p === 'auth' || p === 'admin') ? 'auth' : ['queue', 'voice', 'bridge', 'rooms'].includes(p) ? 'music' : 'other'; };
    const audAll = S.auditGroup ? au.filter(a => audGroup(a) === S.auditGroup) : au;
    const audShown = audAll.slice(0, S.auditShow || 10);
    const audAction = (act) => { const a = String(act || ''); if (a.indexOf('auth.login') === 0) return t('aud_auth_login'); const p = a.split('.')[0]; if (p === 'queue') { const x = a.slice('queue.'.length); return L[lang]['act_' + x] ? t('act_' + x) : x; } const k = 'aud_' + a.replace(/\./g, '_'); return L[lang][k] ? t(k) : a; };
    const audSum = (a) => { const d = a.details || {}; const parts = []; if (d.guildId) parts.push(`<span>${esc(guildName(d.guildId))}</span>`); if (d.key != null) { const gid = String(d.key).match(/\d{17,20}/)?.[0]; if (gid) parts.push(`<span>${esc(guildName(gid))}</span>`); } if (d.via === 'discord') parts.push(`<span class="pill" style="font-size:11px">Discord</span>`); if (d.query != null) parts.push(`<span>${esc(String(d.query))}</span>`); return parts.join(' · '); };
    const audit = audShown.map(a => { const sum = audSum(a); return `<details class="aud"><summary><span class="aud-act">${esc(audAction(a.action))}</span><span class="faint aud-meta">${esc(a.user || '')} · ${esc(ago(a.ts))}</span>${sum ? `<span class="faint ell aud-sum">${sum}</span>` : ''}</summary><pre class="mono faint">${esc(JSON.stringify(a.details || {}, null, 2))}</pre></details>`; }).join('');
    const audFilt = [['', t('all')], ['sub', t('aud_sub')], ['auth', t('aud_auth')], ['music', t('aud_music')], ['other', t('aud_other')]].map(([k, n]) => `<button class="${(S.auditGroup || '') === k ? 'on' : ''}" data-act="audgrp" data-grp="${k}">${esc(n)}</button>`).join('');
    const audLeft = audAll.length - audShown.length;
    const backupsCard = `<div class="card"><h3>${ic('clock')} ${esc(t('backups'))}<div class="grow"></div><button class="btn sm" data-act="backup">${ic('refresh')} ${esc(t('backupNow'))}</button></h3><table class="t"><tbody>${backups || '<tr><td class="faint">—</td></tr>'}</tbody></table>${rsPend}${rsLast}</div>`;
    const auditCard = `<div class="card" style="grid-column:1/-1"><h3>${ic('log')} ${esc(t('auditLog'))} <span class="muted">${audAll.length}</span></h3><div class="filters" style="margin-bottom:8px">${audFilt}</div><div class="aud-list">${audit || '<div class="faint">—</div>'}</div>${audLeft > 0 ? `<button class="btn sm ghost" style="margin-top:8px;width:100%" data-act="auditmore">${esc(t('auditMore'))} (${audLeft})</button>` : ''}</div>`;
    // T82: .env owners add / remove dashboard owners; only they change the password or log everyone out.
    const root = Boolean(S.me?.rootOwner);
    const owners = (ad.owners || []).map(u => `<div class="item"><div class="grow" style="min-width:0"><b class="ell" style="display:block">${nameOf(u)}</b><span class="mono faint" style="font-size:12px">${esc(u)}</span></div><button class="btn sm ghost" data-owner-remove="${esc(u)}">${ic('trash')}</button></div>`).join('');
    const ownersCard = root ? `<div class="card"><h3>${ic('key')} ${esc(t('owners'))}</h3><p class="faint" style="font-size:12px;margin:0 0 8px">${esc(t('ownerHint'))}</p><div class="list">${owners || `<div class="faint">—</div>`}</div>
          <form class="row" style="margin-top:10px" data-form="owner"><input class="input grow mono" name="userId" placeholder="${esc(t('addOwner'))}" inputmode="numeric" pattern="\\d{17,20}" required><button class="btn" type="submit">${ic('plus')}</button></form></div>` : '';
    // T81: managers get the admins list, backups and the audit log (without IPs); the rest is the owner's.
    if (!own) return `${header(esc(t('security')))}<div class="grid g2" style="align-items:start">${adminsCard}${backupsCard}${auditCard}</div>`;
    return `${header(esc(t('security')))}
      <div class="grid g2" style="align-items:start">
        ${root ? `<div class="card"><h3>${ic('key')} ${esc(t('changePw'))}</h3>
          <form class="grid" data-form="password"><label class="field">${esc(t('newPassword'))}<input class="input" type="password" name="password" autocomplete="new-password" minlength="10" required></label><div class="row"><span class="faint grow">${esc(t('pwRule'))}</span><button class="btn primary" type="submit">${esc(t('save'))}</button></div></form></div>` : ''}
        ${ownersCard}
        <div class="card"><h3>${ic('key')} ${esc(t('managers'))}</h3><p class="faint" style="font-size:12px;margin:0 0 8px">${esc(t('mgrHint'))}</p><div class="list">${managers || `<div class="faint">—</div>`}</div>
          <form class="row" style="margin-top:10px" data-form="manager"><input class="input grow mono" name="userId" placeholder="${esc(t('addManager'))}" inputmode="numeric" pattern="\\d{17,20}" required><button class="btn" type="submit">${ic('plus')}</button></form></div>
        ${adminGuildCard(ad.adminGuild)}
        ${adminsCard}
        <div class="card"><h3 style="flex-wrap:wrap">${ic('layers')} ${esc(t('sessions'))} <span class="muted">${ad.sessions.length}</span><div class="grow"></div>${root ? `<button class="btn sm danger" data-act="revoke">${esc(t('revokeAll'))}</button>` : ''}</h3><div class="list">${sessions}</div></div>
        ${backupsCard}
        ${auditCard}
      </div>`;
  }

  // ---------------------------------------------------------------- login
  async function renderLogin() {
    if (S.es) { S.es.close(); S.es = null; }
    const q = parseHash().q;
    let discordBtn = '';
    let pwForm = '';
    try {
      const m = await api('GET', '/api/auth/methods');
      if (m?.discord) discordBtn = `<a class="btn primary" href="/auth/discord/login" style="width:100%;margin:10px 0 2px">${ic('bot')} ${esc(t('loginDiscord'))}</a>`;
      if (m?.password) pwForm = `<div class="sep">${esc(t('orPassword'))}</div><form class="grid" data-form="pwlogin"><input class="input" type="password" name="password" placeholder="${esc(t('password'))}" autocomplete="current-password" required><button class="btn primary" type="submit">${esc(t('login'))}</button></form>`;
    } catch { /* methods not available */ }
    $('#app').innerHTML = `<div class="login"><div class="box">
      <div class="logo">${logo()}<h1>${esc(t('appName'))}</h1><div class="muted">${esc(t('loginTitle'))}</div></div>
      ${q.get('expired') ? `<div class="warnbox" style="margin-bottom:14px">${ic('alert')}<div>${esc(t('expiredLink'))}</div></div>` : ''}
      <div class="card">
        <h3>${ic('bot')} ${esc(t('loginDiscord'))}</h3>
        ${discordBtn}
        <ol class="steps"><li>${esc(t('loginDiscordHint')).replace('dashboard', '<code>dashboard</code>')}</li></ol>
        ${pwForm}
      </div>
      <div class="row" style="justify-content:center;margin-top:14px"><button class="btn ghost sm" data-act="lang">${ic('globe')} ${esc(t('lang'))}</button><button class="btn ghost sm icon" data-act="theme">${ic('sun')}</button></div>
    </div></div>`;
  }

  // ---------------------------------------------------------------- palette
  function openPalette() {
    const opts = [
      ...NAV.filter(([, , , all]) => all || isStaff()).map(([k, href, icon]) => ({ label: t(k), href, icon })),
      ...(S.data.guilds || S.data.overview?.nowPlaying || []).filter(g => g.name).map(g => ({ label: g.name, href: `#/server/${g.id}`, icon: 'server', sub: g.id })),
    ];
    const ov = document.createElement('div');
    ov.className = 'overlay';
    ov.innerHTML = `<div class="palette"><input class="input" placeholder="${esc(t('search'))}" autofocus><div class="res"></div></div>`;
    document.body.appendChild(ov);
    const inp = $('input', ov); const res = $('.res', ov);
    let sel = 0; let shown = opts;
    const draw = () => {
      const q = inp.value.toLowerCase();
      shown = opts.filter(o => !q || o.label.toLowerCase().includes(q) || (o.sub || '').includes(q)).slice(0, 30);
      sel = Math.min(sel, Math.max(0, shown.length - 1));
      res.innerHTML = shown.map((o, i) => `<div class="opt ${i === sel ? 'on' : ''}" data-i="${i}">${ic(o.icon)}<span class="grow">${esc(o.label)}</span>${o.sub ? `<span class="faint mono">${esc(o.sub)}</span>` : ''}</div>`).join('');
    };
    const close = () => { ov.remove(); document.removeEventListener('keydown', key); };
    const pick = (i) => { const o = shown[i]; close(); if (o) go(o.href); };
    const key = (e) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowDown') { sel = Math.min(shown.length - 1, sel + 1); draw(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); }
      else if (e.key === 'Enter') pick(sel);
    };
    document.addEventListener('keydown', key);
    inp.addEventListener('input', () => { sel = 0; draw(); });
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); const o = e.target.closest('.opt'); if (o) pick(+o.dataset.i); });
    draw();
    inp.focus();
    if (!S.data.guilds) api('GET', '/api/guilds').then(l => { S.data.guilds = l; opts.push(...l.map(g => ({ label: g.name, href: `#/server/${g.id}`, icon: 'server', sub: g.id }))); draw(); }).catch(() => {});
  }

  // ---------------------------------------------------------------- events
  async function queueAct(key, body, msg) {
    const r = await act('POST', `/api/queues/${encodeURIComponent(key)}`, body, msg);
    if (r?.vote?.message) toast(r.vote.message, r.vote.skipped ? 'ok' : 'bad');
    if (r) renderPage(true);
    return r;
  }

  document.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-act],[data-q],[data-gtab],[data-gfilter],[data-leave],[data-bridge],[data-subremove],[data-subadd],[data-subsave],[data-subextend],[data-voice],[data-rooms-save],[data-copy],[data-admin-remove],[data-manager-remove],[data-owner-remove],[data-loglevel],[data-replay],[data-qroom],[data-psave],[data-padd],[data-pdel],[data-ptest],[data-listen],[data-lvol],[data-lvreset],[data-guestnew],[data-guestrevoke],[data-roombot],[data-renew]');
    if (!el) return;
    const d = el.dataset;
    if (el.matches('input[type="checkbox"],input[type="range"]')) return; // handled on change
    if (d.act === 'lang') {
      lang = lang === 'ar' ? 'en' : 'ar';
      store.set('oud.lang', lang);
      document.documentElement.lang = lang;
      document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
      return route();
    }
    if (d.act === 'theme') {
      const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
      document.documentElement.dataset.theme = next;
      store.set('oud.theme', next);
      return S.route.page === 'login' ? renderLogin() : renderShell() || renderPage();
    }
    if (d.act === 'nowall') { S.nowAll = !S.nowAll; store.set('oud.nowAll', S.nowAll ? '1' : '0'); return renderPage(); }
    if (d.act === 'nowqall') { S.nowQAll = !S.nowQAll; return renderPage(); }
    if (d.act === 'rpall') { S.rpAll = S.rpAll || {}; S.rpAll[d.room] = !S.rpAll[d.room]; return renderPage(); }
    if (d.listen) { if (LS.gid === d.listen) listenStop(); else listenStart(d.listen, d.llabel); return; }
    if ('lvol' in d) { LS.volOpen = !LS.volOpen; listenVolPanel(); return; }
    if ('lvreset' in d) { LS.vol = {}; listenVolSend(); listenVolPanel(); return; }
    if (d.act === 'replay') return queueAct(d.key, { action: 'play', fromHistory: d.url, ...(d.next ? { next: true } : {}) }, t('added'));
    if (d.act === 'audgrp') { S.auditGroup = d.grp || ''; S.auditShow = 10; return renderPage(); }
    if (d.act === 'sessopen') { S.sessOpen = S.sessOpen === d.k ? null : d.k; return renderPage(); }
    if (d.act === 'revokesess') { await api('POST', '/api/sessions/revoke', { id: d.sid }); toast(t('saved')); return renderPage(); }
    if (d.act === 'revokeuser' && d.uid) { if (!(await modal({ title: t('logout'), danger: true }))) return; await api('POST', '/api/sessions/revoke', { userId: d.uid }); toast(t('saved')); return renderPage(); }
    if (d.act === 'auditmore') { S.auditShow = (S.auditShow || 10) + 20; return renderPage(); }
    if (d.act === 'sidemenu' || d.act === 'sidemenu-close') {
      sideMenuSet(d.act === 'sidemenu' && !document.querySelector('.shell.side-open'));
      return;
    }
    if (d.act === 'usermenu') {
      userMenuSet(!S.umOpen);
      return;
    }
    if (d.act === 'logout') {
      userMenuSet(false);
      await api('POST', '/api/auth/logout', {}).catch(() => {});
      S.me = null;
      return go('#/login');
    }
    if (d.act === 'palette') return openPalette();
    if (d.act === 'logpause') { S.logsPaused = !S.logsPaused; return renderPage(); }
    if (d.act === 'revoke') { if (await modal({ title: t('revokeAll'), danger: true })) { await act('POST', '/api/sessions/revoke', {}); renderPage(); } return; }
    if (d.act === 'tfilter') { S.tFilter = d.st || ''; return renderPage(); }
    if ((d.act === 'tclose' || d.act === 'treopen') && d.id) {
      if (await act('POST', `/api/support/${d.id}`, { action: d.act === 'tclose' ? 'close' : 'reopen' })) renderPage();
      return;
    }
    if (d.act === 'avpreset') {
      const pre = AV_PRESETS[d.preset] || {};
      const attr = $('#av-target')?.value === 'def' ? 'avdef' : 'avg';
      for (const x of $$(`select[data-${attr}]`)) { x.value = pre[x.dataset[attr]] || 'hide'; x.classList.add('changed'); }
      toast(t('avPresetDone'), 'ok');
      return;
    }
    if (d.act === 'avsave' && d.gid) {
      const def = {}, gl = {};
      for (const x of $$('select[data-avdef]')) def[x.dataset.avdef] = x.value;
      for (const x of $$('select[data-avg]')) gl[x.dataset.avg] = x.value;
      await api('POST', `/api/guilds/${d.gid}/adminview`, { scope: 'default', levels: def });
      await api('POST', `/api/guilds/${d.gid}/adminview`, { scope: 'guild', levels: gl });
      toast(t('saved'), 'ok');
      return renderPage();
    }
    if (d.act === 'restore' && d.date) {
      const r = await api('GET', `/api/backups/${encodeURIComponent(d.date)}`);
      if (!r.files?.length) return toast(t('restoreNone'), 'bad');
      const boxes = r.files.map(f => `<label class="row" style="gap:8px;font-size:13px;color:var(--text)"><input type="checkbox" data-rsf value="${esc(f)}" checked><span class="mono ell">${esc(f)}</span></label>`).join('');
      const files = await modal({
        title: `${t('restore')} ${d.date}`, danger: true, confirmText: t('restore'), typeToConfirm: d.date,
        body: `${esc(t('restoreHint'))}<div class="grid" style="gap:4px;margin-top:10px;max-height:240px;overflow:auto">${boxes}</div>`,
        collect: (ov) => [...ov.querySelectorAll('input[data-rsf]:checked')].map(x => x.value),
      });
      if (!files) return;
      if (!files.length) return toast(t('restoreNone'), 'bad');
      if (await act('POST', '/api/restore', { date: d.date, files }, t('restoreStarted'))) setTimeout(() => location.reload(), 45000);
      return renderPage();
    }
    if (d.act === 'restorecancel') { if (await act('POST', '/api/restore', { action: 'cancel' })) renderPage(); return; }
    if (d.act === 'backup') { await act('POST', '/api/backups', {}); return renderPage(); }
    if (d.act === 'bcmode') { bcState().mode = d.mode === 'all' ? 'all' : 'one'; await bcLoadPreview(); return renderPage(); }
    if (d.act === 'bclang') {
      if (await act('POST', '/api/broadcast', { action: 'lang', guildId: d.gid, lang: d.lang }, null)) { await bcLoadPreview(); const r = $('#bc-recip'); if (r) r.innerHTML = bcRecipients(); }
      return;
    }
    if (d.act === 'bcretry') {
      el.disabled = true;
      try { const r = await api('POST', '/api/broadcast', { action: 'retry', id: d.id }); toast(t('bcRetried', r), r.fail ? 'bad' : 'ok'); } catch (err) { toast(err.message === 'busy' ? t('bcBusy') : `${t('failed')}: ${err.message}`, 'bad'); }
      return renderPage();
    }
    if (d.act === 'mscope') {
      const ids = $$(`input[data-mscope="${d.uid}"]:checked`).map(x => x.value);
      if (await act('POST', '/api/managers', { action: 'scope', userId: d.uid, guildIds: ids }, t('saved'))) renderPage();
      return;
    }
    if (d.act === 'bc-schedule') {
      const b = bcState();
      const at = $('#bc-at')?.value;
      if (!b.msg.trim()) return toast(t('bcEmpty'), 'bad');
      if (!at) return toast(t('bcAtNeed'), 'bad');
      const iso = new Date(at).toISOString();
      if (await act('POST', '/api/broadcast', { ...bcBody(), action: 'schedule', at: iso }, t('bcScheduledOk'))) { b.msg = ''; b.msgEn = ''; b.preview = null; renderPage(); }
      return;
    }
    if (d.act === 'bc-unschedule') {
      if (await act('POST', '/api/broadcast', { action: 'unschedule', id: d.id }, t('saved'))) renderPage();
      return;
    }
    if (d.act === 'bc-tplsave') {
      const b = bcState();
      if (!b.msg.trim()) return toast(t('bcEmpty'), 'bad');
      const name = window.prompt(t('bcTplName'));
      if (!name || !name.trim()) return;
      if (await act('POST', '/api/broadcast', { action: 'tplsave', name: name.trim(), message: b.msg, messageEn: b.en ? b.msgEn : '' }, t('saved'))) renderPage();
      return;
    }
    if (d.act === 'bc-tpldel') {
      const name = $('#bc-tpl')?.value;
      if (!name) return;
      if (await act('POST', '/api/broadcast', { action: 'tpldel', name }, t('saved'))) renderPage();
      return;
    }
    if (d.act === 'bc-send') {
      const b = bcState();
      if (!b.msg.trim()) return toast(t('bcEmpty'), 'bad');
      if (b.msg.length > 2000 || (b.en && b.msgEn.length > 2000)) return toast(t('bcTooLong'), 'bad');
      await bcLoadPreview();
      const p = b.preview;
      if (!p || !p.messages) return toast(t('bcNone'), 'bad');
      const sTxt = p.kind === 'owners' ? t('bcSumOwners', { m: p.messages, s: p.servers }) : t('bcSum', { s: p.servers, m: p.messages });
      const body = `${esc(t('bcConfirm', { s: sTxt }))}${b.mentions ? `<div class="warnbox bad" style="margin-top:10px">${ic('alert')}<div>${esc(t('bcConfirmMention'))}</div></div>` : ''}`;
      if (!(await modal({ title: t('send'), body, danger: b.mentions }))) return;
      el.disabled = true;
      try {
        const r = await api('POST', '/api/broadcast', { ...bcBody(), action: 'send' });
        toast(t('sent', r), r.fail ? 'bad' : 'ok');
        b.msg = ''; b.msgEn = ''; b.preview = null; b.exclude = [];
      } catch (err) {
        toast(err.message === 'busy' ? t('bcBusy') : `${t('failed')}: ${err.message}`, 'bad');
      }
      el.disabled = false;
      return renderPage();
    }
    if (d.q) {
      const body = { action: d.q };
      if (d.index) body.index = +d.index;
      if (d.dir) body.direction = d.dir;
      if (d.to) body.to = +d.to;
      if (d.q === 'stop' || d.q === 'clear') {
        if (!(await modal({ title: t(d.q === 'stop' ? 'stop' : 'clear'), danger: true }))) return;
      }
      return queueAct(d.key, body, null);
    }
    if (d.qroom) { store.set(`oud.room.${d.gid}`, d.qroom); return renderPage(true); }
    if (d.replay !== undefined && d.replay) return queueAct(d.key, { action: 'play', query: d.replay }, t('done'));
    if (d.gtab) {
      S.guildTab = d.gtab; store.set('oud.guildTab', d.gtab);
      return go(`#/server/${S.route.params.id}/${d.gtab}`);
    }
    if (d.gfilter) { S.guildFilter = d.gfilter; return renderPage(); }
    if (d.loglevel !== undefined) { S.logLevel = d.loglevel; return renderPage(); }
    if (d.guestnew) {
      const label = document.getElementById('guest-label')?.value || '';
      const hours = Number(document.getElementById('guest-hours')?.value || 24);
      const r = await act('POST', `/api/guilds/${d.guestnew}/guests`, { action: 'create', label, hours }, t('saved'));
      if (r?.token) { S.guestNew = { gid: d.guestnew, url: `${location.origin}/guest.html#${r.token}` }; renderPage(true); }
      return;
    }
    if (d.guestrevoke) {
      if (!(await modal({ title: t('guestRevoke'), body: esc(t('guestRevokeQ')), danger: true, confirmText: t('guestRevoke') }))) return;
      if (await act('POST', `/api/guilds/${S.route.params.id}/guests`, { action: 'revoke', linkId: d.guestrevoke }, t('saved'))) { S.guestNew = null; renderPage(true); }
      return;
    }
    if (d.leave) {
      if (!(await modal({ title: `${t('leaveGuild')}: ${d.name}`, body: esc(t('leaveWarn')), danger: true, typeToConfirm: d.leave, confirmText: t('leave') }))) return;
      if (await act('POST', `/api/guilds/${d.leave}/leave`, { confirm: d.leave })) return S.route.page === 'server' ? go('#/servers') : renderPage();
      return;
    }
    if (d.bridge && el.tagName === 'BUTTON') {
      const r = await act('POST', `/api/guilds/${S.route.params.id}/bridge`, { action: d.bridge, room: d.room, user: d.user }, null);
      if (r) renderPage(true);
      return;
    }
    if (d.subadd) {
      const life = $('#sub-life').checked;
      const patch = { label: $('#sub-label').value.trim() || null, lifetime: life, active: true };
      if (!life) patch.expires = $('#sub-exp').value || null;
      if (await act('POST', `/api/guilds/${d.subadd}/subscription`, { action: 'add', patch }, t('saved'))) renderPage();
      return;
    }
    if (d.subremove) {
      if (!(await modal({ title: t('removeSub'), danger: true, typeToConfirm: d.subremove }))) return;
      if (await act('POST', `/api/guilds/${d.subremove}/subscription`, { action: 'remove', confirm: d.subremove }, t('done'))) renderPage();
      return;
    }
    if (d.subsave) {
      const id = S.route.params.id;
      const patch = d.subsave === 'expires'
        ? { expires: $('#sub-exp').value || null, lifetime: !$('#sub-exp').value }
        : { label: $('#sub-label').value.trim() || null, maxSlaves: +$('#sub-max').value, note: $('#sub-note').value.trim() || null };
      if (await act('POST', `/api/guilds/${id}/subscription`, { action: 'patch', patch }, t('saved'))) renderPage();
      return;
    }
    if (d.subextend) {
      if (await act('POST', `/api/guilds/${S.route.params.id}/subscription`, { action: 'extend', days: +d.subextend }, t('saved'))) renderPage();
      return;
    }
    if (d.renew) {
      el.disabled = true;
      if (await act('POST', `/api/guilds/${d.renew}/renew`, {}, t('planAsked'))) el.textContent = `✓ ${t('planAsked')}`;
      return;
    }
    if (d.roombot) {
      el.disabled = true;
      await act('POST', `/api/guilds/${S.route.params.id}/roombot`, { action: d.roombot, name: d.name }, t('saved'));
      el.disabled = false;
      return renderPage();
    }
    if (d.voice) {
      el.disabled = true;
      await act('POST', `/api/guilds/${S.route.params.id}/voice`, { action: d.voice });
      el.disabled = false;
      return renderPage();
    }
    if (d.roomsSave !== undefined) {
      const body = { voiceChannelId: $('#room-voice').value || null, textChannelId: $('#room-text').value || null };
      if (await act('POST', `/api/guilds/${S.route.params.id}/rooms`, body, t('saved'))) renderPage();
      return;
    }
    if (d.copy) {
      try { await navigator.clipboard.writeText(d.copy); toast(t('copied'), 'ok'); } catch { prompt('', d.copy); }
      return;
    }
    if (d.ownerRemove) {
      if (!(await modal({ title: `${t('owners')}: ${d.ownerRemove}`, danger: true }))) return;
      if (await act('POST', '/api/owners', { action: 'remove', userId: d.ownerRemove })) renderPage();
      return;
    }
    if (d.managerRemove) {
      if (!(await modal({ title: `${t('managers')}: ${d.managerRemove}`, danger: true }))) return;
      if (await act('POST', '/api/managers', { action: 'remove', userId: d.managerRemove })) renderPage();
      return;
    }
    if (d.adminRemove) {
      if (!(await modal({ title: `${t('admins')}: ${d.adminRemove}`, danger: true }))) return;
      if (await act('POST', '/api/admins', { action: 'remove', userId: d.adminRemove })) renderPage();
    }
    if (d.pdel) {
      S.permsDraft = S.permsDraft || {};
      const list = S.permsDraft[d.pdel] ?? permsSettings(S.route.params.id)?.[d.pdel] ?? [];
      S.permsDraft[d.pdel] = list.filter(x => x !== d.pid);
      const c = el.closest('.pm-chip');
      if (c) c.remove();
      return;
    }
    if (d.padd) {
      const input = $(`#pm-${d.padd}`), err = $(`#pm-${d.padd}-err`);
      const v = input.value.trim();
      if (!ID_RE.test(v)) { err.textContent = t('idBad'); return; }
      S.permsDraft = S.permsDraft || {};
      const cur = S.permsDraft[d.padd] ?? permsSettings(S.route.params.id)?.[d.padd] ?? [];
      S.permsDraft[d.padd] = cur.includes(v) ? cur : [...cur, v];
      err.textContent = '';
      return renderPage(true);
    }
    if (d.psave) {
      const gid = S.route.params.id;
      const s = permsSettings(gid);
      const play = $('#pm-play'), max = $('#pm-max'), b1 = $('input[data-pcheck="listenerCanAdd"]');
      if (!s || !play || !max || !b1) return;
      const d0 = S.permsDraft || {};
      const vals = {
        djRoleIds: $$('input[data-pcheck="role"]:checked').map(x => x.dataset.pid).sort(),
        djUserIds: d0.djUserIds ?? s.djUserIds,
        bannedUserIds: d0.bannedUserIds ?? s.bannedUserIds,
        listenerCanAdd: b1.checked,
        listenerVoteSkip: $('input[data-pcheck="listenerVoteSkip"]').checked,
        allowLinks: $('input[data-pcheck="allowLinks"]').checked,
        djOnly: $('input[data-pcheck="djOnly"]').checked,
        listenerCanPause: $('input[data-pcheck="listenerCanPause"]').checked,
        listenerCanVolume: $('input[data-pcheck="listenerCanVolume"]').checked,
        pauseWhenEmpty: $('input[data-pcheck="pauseWhenEmpty"]').checked,
        playPerMin: +play.value,
        maxTrackMin: +max.value,
        maxQueuedPerMember: +$('#pm-mine').value,
        listenerMaxVolume: +$('#pm-vol').value,
      };
      const patch = {};
      for (const k of Object.keys(s)) if (JSON.stringify(vals[k]) !== JSON.stringify(s[k])) patch[k] = vals[k];
      if (!Object.keys(patch).length) return;
      if (await act('POST', `/api/guilds/${gid}/perms`, { patch }, t('saved'))) S.permsDraft = null;
      return;
    }
    if (d.ptest) {
      const gid = S.route.params.id;
      const uid = $('#pm-test-id').value.trim();
      const err = $('#pm-test-err'), out = $('#pm-test-out');
      if (!ID_RE.test(uid)) { out.innerHTML = ''; err.textContent = t('idBad'); return; }
      err.textContent = '';
      el.disabled = true;
      const r = await act('GET', `/api/guilds/${gid}/perms/test?user=${encodeURIComponent(uid)}`, undefined, null);
      el.disabled = false;
      if (!r) return;
      const rows = (r.rooms || []).map(room => `<tr><td><b>${esc(room.channelName ? '#' + room.channelName : room.key)}</b></td><td><span class="pill ${room.level === 'banned' ? 'bad' : ''}">${esc(t('lvl_' + room.level))}</span></td><td><span class="chips">${(room.actions || []).length ? room.actions.map(a => `<span class="pill">${esc(a)}</span>`).join(' ') : '—'}</span></td></tr>`).join('');
      out.innerHTML = `<div class="mono">${esc(r.user?.name || r.user?.id)}</div>${(r.rooms || []).length ? `<table class="t" style="margin-top:8px"><thead><tr><th>${esc(t('channel'))}</th><th>${esc(t('level'))}</th><th>${esc(t('action'))}</th></tr></thead><tbody>${rows}</tbody></table>` : `<div class="faint" style="font-size:12.5px">—</div>`}
        `;
    }
  });

  // T23g: app.css sets .um-pop { display:flex }, which beats the [hidden] UA
  // rule, so the closed state is forced with an inline display:none (and the
  // markup starts closed). Open state is re-applied after every re-render
  // (8 s silent refresh) and every navigation closes the menu.
  function userMenuSet(open) {
    S.umOpen = open;
    const pop = document.getElementById('usermenu-pop');
    if (!pop) return;
    pop.hidden = !open;
    pop.style.display = open ? '' : 'none';
    pop.style.transform = '';
    if (!open) return;
    // Keep the menu fully on screen (8px margin) whatever the language direction.
    const r = pop.getBoundingClientRect();
    const shift = r.left < 8 ? 8 - r.left : (r.right > window.innerWidth - 8 ? window.innerWidth - 8 - r.right : 0);
    if (shift) pop.style.transform = `translateX(${shift}px)`;
  }
  document.addEventListener('pointerdown', (e) => {
    if (!S.umOpen) return;
    const um = document.getElementById('usermenu');
    if (um && um.contains(e.target)) return;
    userMenuSet(false);
  });
  function sideMenuSet(open) {
    document.querySelector('.shell')?.classList.toggle('side-open', open);
  }
  // Picking any page in the drawer closes it (also when it is the current page: no hashchange then).
  document.addEventListener('click', (e) => { if (e.target.closest('.side a')) sideMenuSet(false); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { userMenuSet(false); sideMenuSet(false); }
  });

  document.addEventListener('click', (e) => {
    const bar = e.target.closest('[data-act="seekbar"]');
    if (!bar) return;
    const dur = +bar.dataset.dur;
    if (!dur) return;
    const r = bar.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    queueAct(bar.dataset.key, { action: 'seek', to: Math.round(frac * dur) }, null);
  });

  document.addEventListener('change', async (e) => {
    const el = e.target;
    const d = el.dataset;
    if (d.change && d.key) {
      if (d.change === 'volume') return queueAct(d.key, { action: 'volume', value: +el.value }, null);
      if (d.change === 'filter') return queueAct(d.key, { action: 'filter', value: el.value }, null);
      if (d.change === 'loop') return queueAct(d.key, { action: 'loop', value: el.value }, null);
      if (d.change === 'autodj') return queueAct(d.key, { action: 'autodj', enabled: el.checked }, null);
      if (d.change === 'adjmode') return queueAct(d.key, { action: 'autodjmode', mode: el.value === 'similar' ? 'similar' : 'mood' }, null);
    }
    if (el.id === 'bc-target' || el.id === 'bc-guild') {
      const b = bcState();
      if (el.id === 'bc-target') { b.target = el.value; b.exclude = []; if (b.target === 'owners') b.mode = 'one'; } else b.guildId = el.value;
      b.preview = null;
      await bcLoadPreview();
      return renderPage();
    }
    if (el.id === 'bc-mentions' || el.id === 'bc-en') {
      bcState()[el.id === 'bc-en' ? 'en' : 'mentions'] = el.checked;
      return renderPage();
    }
    if (d.bcx) {
      const b = bcState();
      b.exclude = el.checked ? b.exclude.filter(x => x !== d.bcx) : [...new Set([...b.exclude, d.bcx])];
      await bcLoadPreview();
      const r = $('#bc-recip'); if (r) r.innerHTML = bcRecipients();
      return;
    }
    if (d.bridge === 'enable') {
      await act('POST', `/api/guilds/${S.route.params.id}/bridge`, { action: 'enable', room: d.room }, null);
      return renderPage(true);
    }
    if (d.bridge === 'volume') {
      await act('POST', `/api/guilds/${S.route.params.id}/bridge`, { action: 'volume', room: d.room, value: +el.value }, null);
      return;
    }
    if (d.subtoggle) {
      await act('POST', `/api/guilds/${S.route.params.id}/subscription`, { action: 'patch', patch: { [d.subtoggle]: el.checked } }, t('saved'));
      return renderPage(true);
    }
    if (d.pcheck === 'role') {
      S.permsDraft = S.permsDraft || {};
      const cur = S.permsDraft.djRoleIds ?? permsSettings(S.route.params.id)?.djRoleIds ?? [];
      S.permsDraft.djRoleIds = el.checked ? [...cur, d.pid] : cur.filter(x => x !== d.pid);
      return;
    }
    if (['listenerCanAdd', 'listenerVoteSkip', 'allowLinks', 'djOnly', 'listenerCanPause', 'listenerCanVolume', 'pauseWhenEmpty'].includes(d.pcheck)) {
      S.permsDraft = S.permsDraft || {};
      S.permsDraft[d.pcheck] = el.checked;
      return;
    }
    if (el.id === 'bc-tpl' && el.value) {
      const tpl = (S.bcTpl || []).find(x => x.name === el.value);
      if (!tpl) return;
      const b = bcState();
      b.msg = tpl.message || '';
      b.msgEn = tpl.messageEn || '';
      b.en = Boolean(tpl.messageEn);
      return renderPage(true);
    }
    const PM_NUM = { 'pm-play': 'playPerMin', 'pm-max': 'maxTrackMin', 'pm-mine': 'maxQueuedPerMember', 'pm-vol': 'listenerMaxVolume' };
    if (PM_NUM[el.id]) {
      S.permsDraft = S.permsDraft || {};
      S.permsDraft[PM_NUM[el.id]] = +el.value;
      return;
    }
  });

  document.addEventListener('input', (e) => {
    const el = e.target;
    if (el.id === 'bc-msg' || el.id === 'bc-msg-en') {
      const b = bcState();
      const en = el.id === 'bc-msg-en';
      b[en ? 'msgEn' : 'msg'] = el.value;
      const pv = $(en ? '#bc-pv-en' : '#bc-pv-ar');
      if (pv) pv.innerHTML = mdPreview(el.value);
      const c = el.closest('label')?.querySelector('.bc-count');
      if (c) { c.textContent = t('bcChars', { n: el.value.length }); c.classList.toggle('bad', el.value.length > 2000); }
      bcMentionWarn();
      return;
    }
    if (el.dataset.change === 'volume') {
      const v = $(`[data-volv="${CSS.escape(el.dataset.key)}"]`);
      if (v) v.textContent = `${el.value}%`;
    }
    if (el.matches('[data-gsearch]')) {
      S.guildSearch = el.value;
      clearTimeout(S._gs);
      S._gs = setTimeout(async () => {
        const pos = el.selectionStart;
        await renderPage();
        const n = $('[data-gsearch]');
        if (n) { n.focus(); n.setSelectionRange(pos, pos); }
      }, 250);
    }
    if (el.matches('[data-logq]')) {
      S.logQuery = el.value;
      clearTimeout(S._lq);
      S._lq = setTimeout(async () => {
        const pos = el.selectionStart;
        await renderPage();
        const n = $('[data-logq]');
        if (n) { n.focus(); n.setSelectionRange(pos, pos); }
      }, 350);
    }
  });

  document.addEventListener('keydown', (e) => {
    const el = e.target;
    if (e.key !== 'Enter' || !el.matches?.('[data-adjq]')) return;
    e.preventDefault();
    const query = el.value.trim();
    if (query) queueAct(el.dataset.adjq, { action: 'autodjmode', mode: 'mood', query }, null);
  });

  // Drag a queue item onto another to move it there (up/down buttons stay for touch).
  const clearDrag = () => document.querySelectorAll('.drop-target,.dragging').forEach(n => n.classList.remove('drop-target', 'dragging'));
  document.addEventListener('dragstart', (e) => {
    const it = e.target.closest?.('[data-drag-index]');
    if (!it) return;
    S.drag = { key: it.dataset.key, index: +it.dataset.dragIndex };
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', it.dataset.dragIndex); } catch { /* old browsers */ }
    it.classList.add('dragging');
  });
  document.addEventListener('dragover', (e) => {
    if (!S.drag) return;
    const it = e.target.closest?.('[data-drag-index]');
    if (!it || it.dataset.key !== S.drag.key) return;
    e.preventDefault();
    if (!it.classList.contains('drop-target')) { document.querySelectorAll('.drop-target').forEach(n => n.classList.remove('drop-target')); it.classList.add('drop-target'); }
  });
  document.addEventListener('drop', (e) => {
    const drag = S.drag;
    if (!drag) return;
    const it = e.target.closest?.('[data-drag-index]');
    S.drag = null;
    clearDrag();
    if (!it || it.dataset.key !== drag.key) return;
    e.preventDefault();
    const to = +it.dataset.dragIndex;
    if (to !== drag.index) queueAct(drag.key, { action: 'moveto', index: drag.index, to }, null);
  });
  document.addEventListener('dragend', () => { S.drag = null; clearDrag(); });

  document.addEventListener('submit', async (e) => {
    const f = e.target.closest('form[data-form]');
    if (!f) return;
    e.preventDefault();
    const kind = f.dataset.form;
    const data = Object.fromEntries(new FormData(f).entries());
    const btn = e.submitter;
    if (btn) btn.disabled = true;
    try {
      if (kind === 'pwlogin') {
        const ch = await api('GET', '/api/auth/challenge');
        const proof = await window.OudCrypto.passwordProof(data.password, ch.salt, ch.iterations, ch.nonce);
        try {
          const r = await api('POST', '/api/auth/password', { nonceId: ch.nonceId, proof });
          S.csrf = r.csrf;
          S.me = null;
          return go('#/');
        } catch (err) {
          toast(err.message === 'wrong password' ? t('wrongPw') : err.message, 'bad');
        }
      } else if (kind === 'dmlink') {
        try {
          await api('POST', '/api/auth/discord', { userId: data.userId });
          toast(t('linkSent'), 'ok');
        } catch (err) { toast(err.message, 'bad'); }
      } else if (kind === 'play') {
        const next = btn?.name === 'next';
        const r = await queueAct(f.dataset.key, { action: 'play', query: data.query, next }, null);
        if (r?.added) { toast(`✓ ${r.added.title}`, 'ok'); f.reset(); }
      } else if (kind === 'savepl') {
        const name = String(data.name || '').trim();
        if (!name || name.length > 50) { toast(t('plNameBad'), 'bad'); return; }
        const r = await queueAct(f.dataset.key, { action: 'savepl', name }, null);
        if (r?.saved) { toast(`✓ ${r.saved.name} (${r.saved.count})`, 'ok'); S.plCache.delete(f.dataset.key); f.reset(); }
      } else if (kind === 'loadpl') {
        const r = await queueAct(f.dataset.key, { action: 'loadpl', name: data.name }, null);
        if (r) toast(`✓ ${data.name}`, 'ok');
      } else if (kind === 'password') {
        const r = await act('POST', '/api/password', { password: data.password }, t('saved'));
        if (r) { f.reset(); renderPage(); }
      } else if (kind === 'admin') {
        if (await act('POST', '/api/admins', { action: 'add', userId: data.userId })) renderPage();
      } else if (kind === 'ticket') {
        const r = await act('POST', '/api/support', { kind: data.kind, guildId: data.guildId || null, title: data.title, text: data.text }, t('tSent'));
        if (r?.id) go(`#/support/${r.id}`);
      } else if (kind === 'treply') {
        if (await act('POST', `/api/support/${f.dataset.id}`, { action: 'reply', text: data.text })) renderPage();
      } else if (kind === 'owner') {
        if (await act('POST', '/api/owners', { action: 'add', userId: data.userId })) renderPage();
      } else if (kind === 'manager') {
        if (await act('POST', '/api/managers', { action: 'add', userId: data.userId })) renderPage();
      } else if (kind === 'adminguild') {
        if (await act('POST', '/api/admin-guild', { guildId: data.guildId || null }, t('saved'))) renderPage();
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && S.me) {
      e.preventDefault();
      openPalette();
    }
  });

  window.addEventListener('hashchange', () => { userMenuSet(false); route(); });
  route();
})();
