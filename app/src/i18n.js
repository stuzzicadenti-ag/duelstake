import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SUPPORTED_LANGS = ['en', 'it', 'de', 'fr'];
const DEFAULT_LANG = 'en';

const locales = {};
for (const lang of SUPPORTED_LANGS) {
  const filePath = path.join(__dirname, 'locales', `${lang}.json`);
  locales[lang] = JSON.parse(readFileSync(filePath, 'utf-8'));
}

function createTranslator(lang) {
  const messages = locales[lang] || locales[DEFAULT_LANG];
  const fallback = locales[DEFAULT_LANG];
  return function t(key) {
    return messages[key] || fallback[key] || key;
  };
}

function parseLang(raw) {
  if (!raw || typeof raw !== 'string') return DEFAULT_LANG;
  const code = raw.toLowerCase().trim();
  return SUPPORTED_LANGS.includes(code) ? code : DEFAULT_LANG;
}

export function registerI18n(app) {
  // Language switch route
  app.get('/lang/:code', async (request, reply) => {
    const code = parseLang(request.params.code);
    reply.setCookie('lang', code, {
      path: '/',
      httpOnly: false,
      sameSite: 'lax',
      maxAge: 365 * 24 * 60 * 60,
    });
    const referer = request.headers.referer || '/';
    return reply.redirect(referer);
  });

  // preHandler hook: inject t() and lang into every view
  app.addHook('preHandler', async (request, reply) => {
    if (reply.locals === undefined) reply.locals = {};
    const lang = parseLang(request.cookies.lang);
    reply.locals.lang = lang;
    reply.locals.t = createTranslator(lang);
  });
}

export { SUPPORTED_LANGS, DEFAULT_LANG };
