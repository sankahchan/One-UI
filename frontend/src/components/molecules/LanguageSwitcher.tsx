import { Globe } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { languages, changeLanguage } from '../../i18n';

interface LanguageSwitcherProps {
  compact?: boolean;
}

export function LanguageSwitcher({ compact = false }: LanguageSwitcherProps) {
    const { i18n } = useTranslation();
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const currentCode = String(i18n.resolvedLanguage || i18n.language || 'en').split('-')[0];
    const currentLanguage = languages.find((lang) => lang.code === currentCode) || languages[0];

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleLanguageChange = (langCode: string) => {
        changeLanguage(langCode);
        setIsOpen(false);
    };

    return (
        <div className="relative" ref={dropdownRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`flex items-center rounded-lg text-sm text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700 ${
                    compact ? 'gap-1.5 px-2.5 py-2' : 'gap-2 px-3 py-2'
                }`}
                aria-label="Change language"
            >
                <Globe className="h-4 w-4" />
                <span>{compact ? currentLanguage.code.toUpperCase() : currentLanguage.nativeName}</span>
            </button>

            {isOpen && (
                <div className="absolute right-0 top-full z-50 mt-1 min-w-[140px] rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800">
                    <ul className="py-1">
                        {languages.map((lang) => (
                            <li key={lang.code}>
                                <button
                                    onClick={() => handleLanguageChange(lang.code)}
                                    className={`flex w-full items-center gap-2 px-4 py-2 text-left text-sm transition-colors hover:bg-gray-100 dark:hover:bg-gray-700 ${
                                        lang.code === currentCode
                                            ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/50 dark:text-blue-400'
                                            : 'text-gray-700 dark:text-gray-300'
                                    }`}
                                >
                                    <span>{lang.nativeName}</span>
                                    {!compact ? <span className="text-xs text-gray-400">({lang.name})</span> : null}
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}
