import React, { useState } from 'react';
import { CERTIFICATIONS, Certification, CERTIFICATION_SUBJECTS } from '../constants';

interface LandingScreenProps {
    onNavigateToAuth: (mode: 'login' | 'signup') => void;
}

const CERTIFICATION_DESCRIPTIONS: Record<Certification, string> = {
    '전기기사': '전력 공급의 안정성을 확보하고 전기설비의 공사, 유지보수 및 운용을 담당하는 전문가를 양성하는 국가기술자격입니다. 전력공학, 전기기기, 회로이론 등 전기 공학의 핵심 이론과 실무 능력을 평가합니다.',
    '신재생에너지발전설비기사(태양광)': '태양광 발전 시스템의 기획, 설계, 시공, 운영 및 유지보수 업무를 수행하는 전문 인력을 양성합니다. 친환경 에너지 시대를 선도하는 미래 지향적인 자격증입니다.'
};

const LandingScreen: React.FC<LandingScreenProps> = ({ onNavigateToAuth }) => {
    const [selectedCert, setSelectedCert] = useState<Certification>(CERTIFICATIONS[0]);

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex flex-col">
            {/* Header */}
            <header className="bg-white dark:bg-slate-800 shadow-sm sticky top-0 z-10">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-auto md:h-24 py-4 md:py-0 flex flex-col md:flex-row items-center justify-between gap-4 md:gap-0">
                    <div className="flex items-center">
                        <h1 className="text-6xl font-extrabold font-['Outfit'] text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-teal-500 tracking-tight">
                            JT Academy
                        </h1>
                    </div>
                    <div className="flex items-center gap-4">
                        <button
                            onClick={() => onNavigateToAuth('signup')}
                            className="px-4 py-2 text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
                        >
                            가입하기
                        </button>
                        <button
                            onClick={() => onNavigateToAuth('login')}
                            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md shadow-sm transition-colors"
                        >
                            Log In
                        </button>
                    </div>
                </div>
            </header>

            {/* Main Content */}
            <main className="flex-grow max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 w-full">
                <div className="flex flex-col md:flex-row gap-8 h-auto md:h-[calc(100vh-10rem)]">

                    {/* Left Column: Certification List */}
                    <div className="w-full md:w-1/3 lg:w-1/4 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col h-80 md:h-full">
                        <div className="p-4 bg-slate-100 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
                            <h2 className="font-bold text-lg text-slate-800 dark:text-slate-200">자격증 목록</h2>
                        </div>
                        <div className="flex-grow overflow-y-auto p-2 space-y-2">
                            {CERTIFICATIONS.map((cert) => (
                                <button
                                    key={cert}
                                    onClick={() => setSelectedCert(cert)}
                                    className={`w-full text-left p-4 rounded-lg transition-all duration-200 ${selectedCert === cert
                                        ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 shadow-sm border'
                                        : 'hover:bg-slate-50 dark:hover:bg-slate-700/50 text-slate-600 dark:text-slate-400 border border-transparent'
                                        }`}
                                >
                                    <span className="font-semibold block">{cert}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Right Column: Description */}
                    <div className="w-full md:w-2/3 lg:w-3/4 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col">
                        <div className="p-8 flex-grow overflow-y-auto">
                            <div className="mb-8">
                                <h2 className="text-3xl font-bold text-slate-800 dark:text-slate-100 mb-4">
                                    {selectedCert}
                                </h2>
                                <p className="text-lg text-slate-600 dark:text-slate-300 leading-relaxed">
                                    {CERTIFICATION_DESCRIPTIONS[selectedCert]}
                                </p>
                            </div>

                            <div className="space-y-6">
                                <h3 className="text-xl font-bold text-slate-800 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700 pb-2">
                                    주요 학습 과목
                                </h3>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    {CERTIFICATION_SUBJECTS[selectedCert].map((subject, index) => (
                                        <div
                                            key={index}
                                            className="p-4 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-700 flex items-center gap-3"
                                        >
                                            <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center text-blue-600 dark:text-blue-400 font-bold text-sm">
                                                {index + 1}
                                            </div>
                                            <span className="font-medium text-slate-700 dark:text-slate-300">
                                                {subject}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="mt-12 p-6 bg-gradient-to-r from-blue-50 to-teal-50 dark:from-blue-900/20 dark:to-teal-900/20 rounded-xl border border-blue-100 dark:border-blue-800/30">
                                <div className="text-center">
                                    <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200 mb-2">
                                        지금 바로 학습을 시작하세요!
                                    </h3>
                                    <p className="text-slate-600 dark:text-slate-400 mb-6">
                                        AI 기반 맞춤형 문제와 상세한 해설로 합격의 꿈을 이루세요.
                                    </p>
                                    <button
                                        onClick={() => onNavigateToAuth('signup')}
                                        className="px-8 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-md transition-transform hover:scale-105"
                                    >
                                        무료로 시작하기
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                </div>
            </main>
        </div>
    );
};

export default LandingScreen;
