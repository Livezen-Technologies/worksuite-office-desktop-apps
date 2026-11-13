/*
 * Settings › WorkSuite Office Pro text, English, Sinhala and Tamil. Kept here (not in locale/*.js) like
 * the AI Models screen, until the settings redesign lands; other languages fall back to English.
 * "$1" is replaced by S.fmt(). Feature labels are keyed by the service's feature keys (feat_<key>);
 * the key itself (featFallback) shows for any key without a label.
 */
import { langCode } from "@/services/l10n.js";

export const UPGRADE_URL = "https://worksuitecloud.com/pro";

const en = {
  title: "WorkSuite Office Pro",
  intro: "Pro adds the AI assistant, OCR, PDF signing and conversion to Excel and PowerPoint. Everything else stays free.",
  loading: "Checking your license…",
  downTitle: "The AI service is not running",
  downText: "Start it to check or enter your license. It stops by itself when nothing uses it.",
  start: "Start AI service",
  starting: "Starting…",
  noDesktop: "Your license can be managed only in the WorkSuite Office app.",
  notInstalled: "The AI service is not installed with this copy of WorkSuite Office. Reinstall WorkSuite Office to add it.",
  errorTitle: "Your license could not be checked",
  retry: "Try again",

  planFreeTitle: "Free",
  planFreeText: "The core editors and tools are yours to use. Upgrade to unlock the Pro features below.",
  planProTitle: "Pro",
  planProActive: "Pro is active on this computer.",
  planLapsedTitle: "Pro is not active",

  reasonExpired: "Your license has expired.",
  reasonRevoked: "This license has been revoked.",
  reasonGraceExpired: "Pro could not be confirmed online within 30 days. Connect to the internet to restore it.",
  reasonWrongDevice: "This license is tied to another computer.",
  reasonBadSignature: "This license could not be verified.",
  reasonGeneric: "Pro is not active right now.",

  licensedTo: "Licensed to",
  licenseId: "License",
  expires: "Expires",
  perpetual: "No expiry",
  lastChecked: "Last checked online",
  never: "not yet",

  featuresTitle: "Pro features",
  featuresFreeNote: "Included once you enter a Pro key.",
  featIncluded: "Included",
  featLocked: "Pro",
  featFallback: "$1",
  "feat_assistant": "AI assistant",
  "feat_ocr": "Text recognition (OCR)",
  "feat_pdf.sign": "PDF signing",
  "feat_convert": "Convert PDF to Excel and PowerPoint",

  enterTitle: "Enter a license key",
  enterText: "Paste your key or the contents of your .wslicense file.",
  keyPlaceholder: "Paste your license key",
  activate: "Activate",
  activating: "Activating…",
  deactivate: "Deactivate on this computer",
  deactivating: "Removing…",
  refresh: "Check again",
  refreshing: "Checking…",
  upgrade: "Upgrade to Pro",

  activated: "Pro is now active. Thank you!",
  deactivated: "Pro was removed from this computer.",
  refreshed: "License checked.",
  badKey: "That key could not be read. Check that you copied all of it.",
  verifyFailed: "The license could not be verified: $1",
  actionFailed: "That didn't work: $1",
};

const si = {
  title: "WorkSuite Office Pro",
  intro: "Pro මගින් AI සහායක, OCR, PDF අත්සන් කිරීම සහ Excel සහ PowerPoint වෙත පරිවර්තනය එකතු කරයි. අනෙක් සියල්ල නොමිලේම පවතී.",
  loading: "ඔබේ බලපත්‍රය පරීක්ෂා කරමින්…",
  downTitle: "AI සේවාව ක්‍රියාත්මක නැත",
  downText: "ඔබේ බලපත්‍රය පරීක්ෂා කිරීමට හෝ ඇතුළත් කිරීමට එය ආරම්භ කරන්න. කිසිවක් එය භාවිත නොකරන විට එය තනිවම නතර වේ.",
  start: "AI සේවාව ආරම්භ කරන්න",
  starting: "ආරම්භ කරමින්…",
  noDesktop: "ඔබේ බලපත්‍රය කළමනාකරණය කළ හැක්කේ WorkSuite Office යෙදුමෙහි පමණි.",
  notInstalled: "මෙම WorkSuite Office පිටපත සමඟ AI සේවාව ස්ථාපනය කර නැත. එය එක් කිරීමට WorkSuite Office නැවත ස්ථාපනය කරන්න.",
  errorTitle: "ඔබේ බලපත්‍රය පරීක්ෂා කළ නොහැකි විය",
  retry: "නැවත උත්සාහ කරන්න",

  planFreeTitle: "නොමිලේ",
  planFreeText: "මූලික සංස්කාරක සහ මෙවලම් ඔබට භාවිත කළ හැක. පහත Pro විශේෂාංග අගුළු හැරීමට උත්ශ්‍රේණි කරන්න.",
  planProTitle: "Pro",
  planProActive: "මෙම පරිගණකයේ Pro ක්‍රියාත්මකයි.",
  planLapsedTitle: "Pro ක්‍රියාත්මක නැත",

  reasonExpired: "ඔබේ බලපත්‍රයේ කල් ඉකුත් වී ඇත.",
  reasonRevoked: "මෙම බලපත්‍රය අවලංගු කර ඇත.",
  reasonGraceExpired: "දින 30ක් ඇතුළත අන්තර්ජාලයෙන් Pro තහවුරු කළ නොහැකි විය. එය නැවත ලබා ගැනීමට අන්තර්ජාලයට සම්බන්ධ වන්න.",
  reasonWrongDevice: "මෙම බලපත්‍රය වෙනත් පරිගණකයකට බැඳී ඇත.",
  reasonBadSignature: "මෙම බලපත්‍රය සත්‍යාපනය කළ නොහැකි විය.",
  reasonGeneric: "දැන් Pro ක්‍රියාත්මක නැත.",

  licensedTo: "බලපත්‍රලාභියා",
  licenseId: "බලපත්‍රය",
  expires: "කල් ඉකුත් වේ",
  perpetual: "කල් ඉකුත්වීමක් නැත",
  lastChecked: "අන්තර්ජාලයෙන් අවසන් වරට පරීක්ෂා කළේ",
  never: "තවම නැත",

  featuresTitle: "Pro විශේෂාංග",
  featuresFreeNote: "Pro යතුරක් ඇතුළත් කළ පසු ඇතුළත් වේ.",
  featIncluded: "ඇතුළත්",
  featLocked: "Pro",
  featFallback: "$1",
  "feat_assistant": "AI සහායක",
  "feat_ocr": "අකුරු හඳුනාගැනීම (OCR)",
  "feat_pdf.sign": "PDF අත්සන් කිරීම",
  "feat_convert": "PDF Excel සහ PowerPoint වෙත පරිවර්තනය",

  enterTitle: "බලපත්‍ර යතුරක් ඇතුළත් කරන්න",
  enterText: "ඔබේ යතුර හෝ ඔබේ .wslicense ගොනුවේ අන්තර්ගතය අලවන්න.",
  keyPlaceholder: "ඔබේ බලපත්‍ර යතුර අලවන්න",
  activate: "සක්‍රිය කරන්න",
  activating: "සක්‍රිය කරමින්…",
  deactivate: "මෙම පරිගණකයෙන් ඉවත් කරන්න",
  deactivating: "ඉවත් කරමින්…",
  refresh: "නැවත පරීක්ෂා කරන්න",
  refreshing: "පරීක්ෂා කරමින්…",
  upgrade: "Pro වෙත උත්ශ්‍රේණි කරන්න",

  activated: "දැන් Pro ක්‍රියාත්මකයි. ස්තූතියි!",
  deactivated: "මෙම පරිගණකයෙන් Pro ඉවත් කරන ලදී.",
  refreshed: "බලපත්‍රය පරීක්ෂා කරන ලදී.",
  badKey: "එම යතුර කියවිය නොහැකි විය. ඔබ එය සම්පූර්ණයෙන් පිටපත් කළාදැයි පරීක්ෂා කරන්න.",
  verifyFailed: "බලපත්‍රය සත්‍යාපනය කළ නොහැකි විය: $1",
  actionFailed: "එය ක්‍රියා නොකළේය: $1",
};

const ta = {
  title: "WorkSuite Office Pro",
  intro: "Pro ஆனது AI உதவியாளர், OCR, PDF கையொப்பமிடல் மற்றும் Excel மற்றும் PowerPoint ஆக மாற்றுதலைச் சேர்க்கிறது. மற்ற அனைத்தும் இலவசமாகவே இருக்கும்.",
  loading: "உங்கள் உரிமத்தைச் சரிபார்க்கிறது…",
  downTitle: "AI சேவை இயங்கவில்லை",
  downText: "உங்கள் உரிமத்தைச் சரிபார்க்க அல்லது உள்ளிட அதைத் தொடங்குங்கள். எதுவும் பயன்படுத்தாதபோது அது தானாகவே நிறுத்தப்படும்.",
  start: "AI சேவையைத் தொடங்கு",
  starting: "தொடங்குகிறது…",
  noDesktop: "உங்கள் உரிமத்தை WorkSuite Office செயலியில் மட்டுமே நிர்வகிக்க முடியும்.",
  notInstalled: "இந்த WorkSuite Office நகலுடன் AI சேவை நிறுவப்படவில்லை. அதைச் சேர்க்க WorkSuite Office ஐ மீண்டும் நிறுவவும்.",
  errorTitle: "உங்கள் உரிமத்தைச் சரிபார்க்க முடியவில்லை",
  retry: "மீண்டும் முயற்சி செய்",

  planFreeTitle: "இலவசம்",
  planFreeText: "அடிப்படை தொகுப்பிகளும் கருவிகளும் உங்கள் பயன்பாட்டுக்கு உள்ளன. கீழே உள்ள Pro அம்சங்களைத் திறக்க மேம்படுத்துங்கள்.",
  planProTitle: "Pro",
  planProActive: "இந்தக் கணினியில் Pro செயலில் உள்ளது.",
  planLapsedTitle: "Pro செயலில் இல்லை",

  reasonExpired: "உங்கள் உரிமத்தின் காலம் முடிந்துவிட்டது.",
  reasonRevoked: "இந்த உரிமம் ரத்து செய்யப்பட்டுள்ளது.",
  reasonGraceExpired: "30 நாட்களுக்குள் இணையத்தில் Pro ஐ உறுதிப்படுத்த முடியவில்லை. அதை மீட்டெடுக்க இணையத்துடன் இணையுங்கள்.",
  reasonWrongDevice: "இந்த உரிமம் வேறு கணினியுடன் இணைக்கப்பட்டுள்ளது.",
  reasonBadSignature: "இந்த உரிமத்தைச் சரிபார்க்க முடியவில்லை.",
  reasonGeneric: "இப்போது Pro செயலில் இல்லை.",

  licensedTo: "உரிமம் பெற்றவர்",
  licenseId: "உரிமம்",
  expires: "காலாவதியாகும்",
  perpetual: "காலாவதியில்லை",
  lastChecked: "கடைசியாக இணையத்தில் சரிபார்க்கப்பட்டது",
  never: "இன்னும் இல்லை",

  featuresTitle: "Pro அம்சங்கள்",
  featuresFreeNote: "Pro விசையை உள்ளிட்டவுடன் சேர்க்கப்படும்.",
  featIncluded: "சேர்க்கப்பட்டது",
  featLocked: "Pro",
  featFallback: "$1",
  "feat_assistant": "AI உதவியாளர்",
  "feat_ocr": "எழுத்து அறிதல் (OCR)",
  "feat_pdf.sign": "PDF கையொப்பமிடல்",
  "feat_convert": "PDF ஐ Excel மற்றும் PowerPoint ஆக மாற்றுதல்",

  enterTitle: "ஒரு உரிம விசையை உள்ளிடவும்",
  enterText: "உங்கள் விசை அல்லது உங்கள் .wslicense கோப்பின் உள்ளடக்கத்தை ஒட்டவும்.",
  keyPlaceholder: "உங்கள் உரிம விசையை ஒட்டவும்",
  activate: "செயல்படுத்து",
  activating: "செயல்படுத்துகிறது…",
  deactivate: "இந்தக் கணினியிலிருந்து அகற்று",
  deactivating: "அகற்றுகிறது…",
  refresh: "மீண்டும் சரிபார்",
  refreshing: "சரிபார்க்கிறது…",
  upgrade: "Pro ஆக மேம்படுத்து",

  activated: "இப்போது Pro செயலில் உள்ளது. நன்றி!",
  deactivated: "இந்தக் கணினியிலிருந்து Pro அகற்றப்பட்டது.",
  refreshed: "உரிமம் சரிபார்க்கப்பட்டது.",
  badKey: "அந்த விசையைப் படிக்க முடியவில்லை. அதை முழுமையாக நகலெடுத்தீர்களா எனச் சரிபார்க்கவும்.",
  verifyFailed: "உரிமத்தைச் சரிபார்க்க முடியவில்லை: $1",
  actionFailed: "அது வேலை செய்யவில்லை: $1",
};

export const TABLES = { en, si, ta };

export function tableFor(code) {
  const c = String(code || "en").slice(0, 2).toLowerCase();
  return TABLES[c] || en;
}

export const S = new Proxy(
  {},
  {
    get(_, key) {
      if (key === "fmt") return (k, ...args) => args.reduce((s, a, i) => s.replace("$" + (i + 1), a), S[k]);
      const table = tableFor(langCode());
      return table[key] ?? en[key] ?? String(key);
    },
  },
);
