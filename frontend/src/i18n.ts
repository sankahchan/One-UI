import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './locales/en.json';
import my from './locales/my.json';

const STORAGE_KEY = 'one-ui-language';

const savedLanguage = typeof window !== 'undefined'
    ? localStorage.getItem(STORAGE_KEY) || 'en'
    : 'en';

i18n
    .use(initReactI18next)
    .init({
        resources: {
            en: { translation: en },
            my: { translation: my }
        },
        lng: savedLanguage,
        fallbackLng: 'en',
        interpolation: {
            escapeValue: false
        },
        react: {
            useSuspense: false
        }
    });

export const changeLanguage = (lang: string) => {
    i18n.changeLanguage(lang);
    localStorage.setItem(STORAGE_KEY, lang);
};

export const languages = [
    { code: 'en', name: 'English', nativeName: 'English' },
    { code: 'my', name: 'Burmese', nativeName: 'မြန်မာ' }
];

export default i18n;
