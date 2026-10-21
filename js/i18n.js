// User-facing text. Every screen picks its language: the sign-in screens use the browser language
// (Spanish by default), and once the project is known, `projects.language` decides.

export const SUPPORTED = ["es", "en"];
export const DEFAULT_LANGUAGE = "es";

export const dictionaries = {
  es: {
    brand: "Portal de proyectos",
    dismiss: "Cerrar aviso",
    retry: "Reintentar",

    signInPageTitle: "Entrar",
    signInTitle: "Entra con tu correo",
    signInLead: "Aquí respondes y envías lo que te compartimos, sin descargar archivos.",
    emailLabel: "Tu correo",
    emailHint: "Usa el correo con el que te invitaron.",
    sendCode: "Enviarme el código",
    sending: "Enviando…",
    haveCode: "Ya tengo un código",
    emailRequired: "Escribe tu correo para recibir el código.",
    emailInvalid: "Ese correo no parece completo. Revisa que tenga @ y un dominio, como nombre@empresa.com.",
    stepsTitle: "Entras en tres pasos",
    step1: "Escribe tu correo.",
    step2: "Te llega un correo con un código de {length} números.",
    step3: "Escribe el código aquí y verás lo que te compartimos.",

    codeTitle: "Escribe el código",
    codeSentTo: "Te enviamos un código de {length} números a {email}. Puede tardar un minuto; si no lo ves, revisa el correo no deseado.",
    codeLabel: "Código de {length} números",
    verify: "Entrar",
    verifying: "Comprobando…",
    codeIncomplete: "Faltan números: el código tiene {length}.",
    codeInvalid: "Ese código no sirve: está mal escrito o ya venció. Revísalo o pide uno nuevo.",
    tooManyAttempts: "Hubo demasiados intentos. Espera un momento y vuelve a intentarlo.",
    rateLimitSend: "Ya te enviamos un código hace poco. Puedes pedir otro en {seconds} s.",
    resendIn: "Puedes pedir otro código en {seconds} s.",
    resend: "Enviarme otro código",
    codeResent: "Listo, te enviamos otro código.",
    useOtherEmail: "Usar otro correo",
    networkError: "No hay conexión. Revisa tu internet y vuelve a intentarlo.",
    unknownError: "Algo falló de nuestro lado. Vuelve a intentarlo en un momento.",

    homePageTitle: "Lo que te compartimos",
    homeTitle: "Lo que te compartimos",
    signedInAs: "Entraste como {email}",
    signOut: "Salir",
    unsavedSignOut: "Tienes cambios sin guardar y ahora no hay conexión para guardarlos. Si sales, se perderán.",
    signOutAnyway: "Salir y perder los cambios",
    stay: "Quedarme",
    signedOutOffline: "Saliste de tu cuenta en este dispositivo. No había conexión, pero no tienes que hacer nada más.",
    countToAnswer: "{count} por responder",
    countOneToAnswer: "1 por responder",
    countAllSent: "Todo enviado",
    loadingList: "Cargando lo que te compartimos…",
    loadError: "No pudimos cargar tu lista. Revisa tu conexión y vuelve a intentarlo.",
    emptyTitle: "Aquí verás lo que te compartan",
    emptyBody: "Todavía no hay nada para {email}. Si esperabas algo, puede que te hayan invitado con otro correo.",
    emptyAction: "Entrar con otro correo",
    refresh: "Actualizar",
    kindQuestions: "Preguntas",
    kindFlowReview: "Revisión de recorridos",
    kindDemoReview: "Revisión de la demo",
    statusPending: "Por empezar",
    statusInProgress: "En curso",
    statusSubmitted: "Enviada",
    sharedOn: "Compartida el {date}",
    changedOn: "Último cambio el {date}",
    sentOn: "Enviada el {date}",
    untitled: "Sin título",
    unsavedElsewhere: "Hay cambios que todavía no se guardaron. Se guardan solos cuando vuelva la conexión; no cierres esta página.",

    back: "Volver",
    backLabel: "Volver a lo que te compartimos",
    opening: "Abriendo…",
    pieceLoadErrorTitle: "No se pudo abrir",
    pieceNotFoundTitle: "No está disponible",
    pieceLoadError: "No pudimos abrir esto. Revisa tu conexión y vuelve a intentarlo.",
    pieceNotFound: "No encontramos esto entre lo que te compartieron. Puede que ya no esté disponible.",
    saving: "Guardando…",
    saved: "Guardado",
    saveError: "Sin guardar: no hay conexión. Lo intentamos de nuevo solos.",
    noPersistence: "En este navegador tus avances no se guardan si sales. Termina y envía antes de cerrar.",
    sentAt: "Enviada el {date}",
    pieceNavigated: "Esta página se salió de su contenido, así que la cerramos por seguridad. Lo que ya se guardó sigue aquí.",
    reopen: "Abrir de nuevo",
    sessionExpired: "Tu sesión terminó. Vuelve a entrar con tu correo; lo que respondiste sigue guardado.",
    signInAgain: "Entrar de nuevo",
  },
  en: {
    brand: "Project portal",
    dismiss: "Dismiss notice",
    retry: "Try again",

    signInPageTitle: "Sign in",
    signInTitle: "Sign in with your email",
    signInLead: "Answer and send what we shared with you, right here, without downloading files.",
    emailLabel: "Your email",
    emailHint: "Use the email you were invited with.",
    sendCode: "Send me a code",
    sending: "Sending…",
    haveCode: "I already have a code",
    emailRequired: "Enter your email to get a code.",
    emailInvalid: "That email looks incomplete. Check it has an @ and a domain, like name@company.com.",
    stepsTitle: "Three steps to get in",
    step1: "Enter your email.",
    step2: "You get an email with a {length}-digit code.",
    step3: "Enter the code here to see what we shared with you.",

    codeTitle: "Enter the code",
    codeSentTo: "We sent a {length}-digit code to {email}. It can take a minute; if you don't see it, check your spam folder.",
    codeLabel: "{length}-digit code",
    verify: "Sign in",
    verifying: "Checking…",
    codeIncomplete: "Some digits are missing: the code has {length}.",
    codeInvalid: "That code doesn't work: it's mistyped or expired. Check it or ask for a new one.",
    tooManyAttempts: "Too many attempts. Wait a moment and try again.",
    rateLimitSend: "We sent you a code a moment ago. You can ask for another in {seconds} s.",
    resendIn: "You can ask for another code in {seconds} s.",
    resend: "Send me another code",
    codeResent: "Done, we sent you another code.",
    useOtherEmail: "Use a different email",
    networkError: "You're offline. Check your internet and try again.",
    unknownError: "Something went wrong on our side. Try again in a moment.",

    homePageTitle: "Shared with you",
    homeTitle: "Shared with you",
    signedInAs: "Signed in as {email}",
    signOut: "Sign out",
    unsavedSignOut: "You have unsaved changes and there's no connection to save them right now. If you sign out, they'll be lost.",
    signOutAnyway: "Sign out and lose the changes",
    stay: "Stay",
    signedOutOffline: "You signed out on this device. There was no connection, but there's nothing else you need to do.",
    countToAnswer: "{count} to answer",
    countOneToAnswer: "1 to answer",
    countAllSent: "All sent",
    loadingList: "Loading what we shared with you…",
    loadError: "We couldn't load your list. Check your connection and try again.",
    emptyTitle: "What's shared with you will show up here",
    emptyBody: "There's nothing for {email} yet. If you were expecting something, you may have been invited with a different email.",
    emptyAction: "Sign in with a different email",
    refresh: "Refresh",
    kindQuestions: "Questions",
    kindFlowReview: "Flow review",
    kindDemoReview: "Demo review",
    statusPending: "Not started",
    statusInProgress: "In progress",
    statusSubmitted: "Sent",
    sharedOn: "Shared on {date}",
    changedOn: "Last change on {date}",
    sentOn: "Sent on {date}",
    untitled: "Untitled",
    unsavedElsewhere: "Some changes aren't saved yet. They save on their own when the connection is back; don't close this page.",

    back: "Back",
    backLabel: "Back to what we shared with you",
    opening: "Opening…",
    pieceLoadErrorTitle: "Couldn't open",
    pieceNotFoundTitle: "Not available",
    pieceLoadError: "We couldn't open this. Check your connection and try again.",
    pieceNotFound: "We couldn't find this among what was shared with you. It may no longer be available.",
    saving: "Saving…",
    saved: "Saved",
    saveError: "Not saved: you're offline. We'll keep trying on our own.",
    noPersistence: "In this browser your progress isn't kept if you leave. Finish and send before closing.",
    sentAt: "Sent on {date}",
    pieceNavigated: "This page left its content, so we closed it for safety. What was already saved is still here.",
    reopen: "Open again",
    sessionExpired: "Your session ended. Sign in again with your email; your answers are still saved.",
    signInAgain: "Sign in again",
  },
};

export function pickLanguage(preferred) {
  const list = Array.isArray(preferred) ? preferred : [preferred];
  for (const tag of list) {
    const base = String(tag || "").toLowerCase().split("-")[0];
    if (SUPPORTED.includes(base)) return base;
  }
  return DEFAULT_LANGUAGE;
}

export function translate(lang, key, params = {}) {
  const dict = dictionaries[lang] || dictionaries[DEFAULT_LANGUAGE];
  const text = dict[key] ?? dictionaries[DEFAULT_LANGUAGE][key] ?? key;
  return text.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m));
}

// "16 oct." / "Oct 16"; the year only when it is not the current one; optional time.
export function formatDate(lang, iso, { withTime = false } = {}) {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) return "";
  const options = { day: "numeric", month: "short" };
  if (date.getFullYear() !== new Date().getFullYear()) options.year = "numeric";
  if (withTime) { options.hour = "numeric"; options.minute = "2-digit"; }
  return new Intl.DateTimeFormat(lang, options).format(date);
}
