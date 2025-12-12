import React, { useState, useEffect, useCallback } from 'react';
import { Screen, LearningProgress, AuthSession } from '../types';
import { quizApi } from '../services/quizApi';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Certification, getSubjectsByCertification } from '../constants';
import { useMediaQuery } from '../hooks/useMediaQuery';

type PhaseStatusRecord = {
    history: {
        accuracy: number;
        date: string;
        totalQuestions: number;
        correctCount: number;
    }[];
    ready: boolean;
};

interface DashboardScreenProps {
    navigate: (screen: Screen) => void;
    startMockTest: () => void;
    session: AuthSession;
    certification: Certification;
    phaseStatuses: Record<string, PhaseStatusRecord>;
    canStartPhase2: boolean;
}

const DashboardScreen: React.FC<DashboardScreenProps> = ({ navigate, startMockTest, session, certification, phaseStatuses, canStartPhase2 }) => {
    const [progress, setProgress] = useState<LearningProgress | null>(null);
    const [reviewDueCounts, setReviewDueCounts] = useState({ seven: 0, thirty: 0 });
    const isMobile = useMediaQuery('(max-width: 768px)');

    const fetchProgress = useCallback(async () => {
        if (session) {
            const data = await quizApi.getLearningProgress(session.user.id, certification);
            setProgress(data);
        }
    }, [session, certification]);

    useEffect(() => {
        fetchProgress();
    }, [fetchProgress]);

    useEffect(() => {
        const fetchDueReviews = async () => {
            const wrongAnswers = await quizApi.getWrongAnswers(session.user.id);
            const now = Date.now();
            let seven = 0;
            let thirty = 0;
            wrongAnswers.forEach(item => {
                const diffDays = (now - item.addedDate.getTime()) / (1000 * 60 * 60 * 24);
                if (diffDays >= 30) {
                    thirty += 1;
                } else if (diffDays >= 7) {
                    seven += 1;
                }
            });
            setReviewDueCounts({ seven, thirty });
        };

        fetchDueReviews();
    }, [session]);

    if (!progress) {
        return <div className="text-center p-8">학습 진행율 로딩 중...</div>;
    }

    // Filter stats based on certification
    const certSubjects = getSubjectsByCertification(certification);
    const filteredSubjectStats = progress.subjectStats.filter(s => certSubjects.includes(s.subject));

    // Recalculate totals based on filtered stats
    const solvedQuestions = filteredSubjectStats.reduce((acc, s) => acc + s.solvedCount, 0);
    const totalQuestions = filteredSubjectStats.reduce((acc, s) => acc + s.totalCount, 0);

    const completionRate = totalQuestions > 0 ? (solvedQuestions / totalQuestions) * 100 : 0;

    const totalCorrect = filteredSubjectStats.reduce((acc, s) => acc + s.correct, 0);
    const totalAttempted = filteredSubjectStats.reduce((acc, s) => acc + s.total, 0);
    const accuracy = totalAttempted > 0 ? (totalCorrect / totalAttempted) * 100 : 0;

    const phaseInsights = certSubjects.map(subject => {
        const subjectStatus = phaseStatuses[subject];
        const latestAccuracy = subjectStatus?.history?.[0]?.accuracy ?? null;
        const ready = subjectStatus?.ready ?? false;
        const subjectMessage = ready
            ? `${subject} 오답률 ${(latestAccuracy !== null ? (100 - latestAccuracy).toFixed(1) : '—')}% 이하입니다. 다음 과목이나 CBT 모의고사를 진행해 보세요.`
            : `${subject} 최근 정확도 ${(latestAccuracy ?? 0).toFixed(1)}%. 70% 이상을 3회 연속 달성하면 Phase 2가 열립니다.`;

        return {
            subject,
            ready,
            latestAccuracy,
            subjectMessage
        };
    });

    const firstLockedSubject = certSubjects.find(subject => !(phaseStatuses[subject]?.ready));
    const motivationalMessage = firstLockedSubject
        ? `${firstLockedSubject} 정확도를 조금만 더 끌어올려 Phase 2로 전환해 보세요!`
        : '모든 과목에서 Phase 1 목표를 달성했습니다. 이제 CBT 모의고사와 AI 변형 문제로 실전 감각을 키워보세요.';

    return (
        <div className="space-y-8">
            {/* 메인 메뉴 버튼 */}
            <div className="space-y-4">
                <div className="flex flex-col md:flex-row gap-4">
                    <button
                        onClick={() => navigate('subject-select')}
                        className="w-full md:flex-1 bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-4 rounded-lg transition-transform transform hover:scale-105"
                    >
                        학습하기
                    </button>
                    <button
                        onClick={startMockTest}
                        disabled={!canStartPhase2}
                        className={`w-full md:flex-1 font-bold py-3 px-4 rounded-lg transition-transform transform hover:scale-105 ${canStartPhase2 ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-slate-400 text-white cursor-not-allowed'}`}
                    >
                        CBT 모의고사 시작
                    </button>
                    <button
                        onClick={() => navigate('wrong-note')}
                        className="w-full md:flex-1 bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-4 rounded-lg transition-transform transform hover:scale-105 disabled:bg-slate-500 disabled:cursor-not-allowed"
                        disabled={progress.totalWrongAnswers === 0}
                    >
                        오답 노트 학습 ({progress.totalWrongAnswers})
                    </button>
                </div>
                {!canStartPhase2 && (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                        각 과목에서 정답률 70% 이상을 3회 연속 달성하면 CBT 모의고사가 활성화됩니다.
                    </p>
                )}
            </div>

            <div>
                <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-200 mb-6">학습 진행율 ({certification})</h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* 완성도 카드 */}
                    <div className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-800/20 p-6 rounded-xl shadow-lg border border-blue-200 dark:border-blue-700 hover:shadow-xl transition-shadow">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-base font-semibold text-blue-700 dark:text-blue-300 uppercase tracking-wide">완성도</h3>
                            <svg className="w-6 h-6 text-blue-500 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                        </div>
                        <p className="text-5xl font-bold text-blue-600 dark:text-blue-400 mb-2">{completionRate.toFixed(1)}%</p>
                        <p className="text-sm text-blue-600/70 dark:text-blue-300/70">{solvedQuestions} / {totalQuestions} 문제</p>
                    </div>

                    {/* 정확도 카드 */}
                    <div className="bg-gradient-to-br from-green-50 to-green-100 dark:from-green-900/20 dark:to-green-800/20 p-6 rounded-xl shadow-lg border border-green-200 dark:border-green-700 hover:shadow-xl transition-shadow">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-base font-semibold text-green-700 dark:text-green-300 uppercase tracking-wide">정확도</h3>
                            <svg className="w-6 h-6 text-green-500 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                            </svg>
                        </div>
                        <p className="text-5xl font-bold text-green-600 dark:text-green-400 mb-2">{accuracy.toFixed(1)}%</p>
                        <p className="text-sm text-green-600/70 dark:text-green-300/70">전체 정답률</p>
                    </div>

                    {/* 복습 항목 카드 */}
                    <div className="bg-gradient-to-br from-red-50 to-red-100 dark:from-red-900/20 dark:to-red-800/20 p-6 rounded-xl shadow-lg border border-red-200 dark:border-red-700 hover:shadow-xl transition-shadow">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-base font-semibold text-red-700 dark:text-red-300 uppercase tracking-wide">복습 항목</h3>
                            <svg className="w-6 h-6 text-red-500 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                        </div>
                        <p className="text-5xl font-bold text-red-600 dark:text-red-400 mb-2">{progress.totalWrongAnswers}</p>
                        <p className="text-sm text-red-600/70 dark:text-red-300/70">틀린 문제 (전체)</p>
                    </div>
                </div>
            </div>

            {phaseInsights.length > 0 && (
                <div>
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-xl font-bold text-slate-800 dark:text-slate-200">Phase 1 → Phase 2 준비도</h3>
                        <span className="text-sm text-slate-500 dark:text-slate-400">{motivationalMessage}</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {phaseInsights.map(({ subject, ready, latestAccuracy, subjectMessage }) => (
                            <div key={subject} className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="font-semibold text-slate-800 dark:text-slate-100">{subject}</span>
                                    <span className={`text-xs font-bold px-2 py-1 rounded-full ${ready ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200' : 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200'}`}>
                                        {ready ? 'Phase 2 준비 완료' : 'Phase 1 진행 중'}
                                    </span>
                                </div>
                                <p className="text-3xl font-bold text-slate-900 dark:text-slate-50 mb-1">
                                    {latestAccuracy !== null ? `${latestAccuracy.toFixed(1)}%` : '—'}
                                </p>
                                <p className="text-sm text-slate-500 dark:text-slate-400">{subjectMessage}</p>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {filteredSubjectStats.length > 0 && (
                <div>
                    <h3 className="text-xl font-bold text-slate-800 dark:text-slate-200 mb-4">과목별 학습 진행율</h3>
                    <div className="w-full bg-slate-100 dark:bg-slate-700 rounded-lg p-4 overflow-x-auto">
                        {/* Chart for subject progress */}
                        <div style={{ width: '100%', height: 300 }}>
                            <ResponsiveContainer width="100%" height={300}>
                                <BarChart
                                    data={filteredSubjectStats.map(s => ({
                                        ...s,
                                        progress: s.totalCount > 0 ? (s.solvedCount / s.totalCount) * 100 : 0
                                    }))}
                                    layout={isMobile ? 'vertical' : 'horizontal'}
                                    margin={{ top: 5, right: 30, left: isMobile ? -40 : -10, bottom: 5 }}
                                >
                                    <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
                                    {isMobile ? (
                                        <>
                                            <XAxis type="number" unit="%" />
                                            <YAxis
                                                dataKey="subject"
                                                type="category"
                                                width={140}
                                                tick={{ fontSize: 10 }}
                                                orientation="left"
                                            />
                                        </>
                                    ) : (
                                        <>
                                            <XAxis
                                                dataKey="subject"
                                                interval={0}
                                                tick={({ x, y, payload }) => {
                                                    const text = payload.value;
                                                    // Specific logic for known long subjects
                                                    let lines = [text];
                                                    if (text === "회로이론 및 제어공학" || text === "회로이론 및 제어 공학") {
                                                        lines = ["회로이론 및", "제어공학"];
                                                    } else if (text === "전기설비기술기준 및 판단기준") {
                                                        lines = ["전기설비기술기준", "및 판단기준"];
                                                    } else if (text.length > 8) {
                                                        // General split for long names
                                                        const mid = Math.floor(text.length / 2);
                                                        lines = [text.substring(0, mid), text.substring(mid)];
                                                    }

                                                    return (
                                                        <g transform={`translate(${x},${y})`}>
                                                            {lines.map((line: string, index: number) => (
                                                                <text
                                                                    key={index}
                                                                    x={0}
                                                                    y={0}
                                                                    dy={16 + index * 12}
                                                                    textAnchor="middle"
                                                                    fill="#666"
                                                                    fontSize={12}
                                                                >
                                                                    {line}
                                                                </text>
                                                            ))}
                                                        </g>
                                                    );
                                                }}
                                                height={60}
                                            />
                                            <YAxis unit="%" />
                                        </>
                                    )}
                                    <Tooltip
                                        contentStyle={{
                                            backgroundColor: 'rgba(30, 41, 59, 0.8)',
                                            borderColor: 'rgba(100, 116, 139, 0.5)'
                                        }}
                                        formatter={(value: number, name: string, props: any) => {
                                            if (name === '진행율 (%)') {
                                                return [`${value.toFixed(1)}%`, name];
                                            }
                                            return [value, name];
                                        }}
                                    />
                                    <Legend />
                                    <Bar dataKey="progress" fill="#10b981" name="진행율 (%)" />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 border-t border-slate-200 dark:border-slate-700 pt-4">
                <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                    <h4 className="text-sm font-semibold text-amber-800 dark:text-amber-200 mb-2">분산 학습 리마인더</h4>
                    <p className="text-3xl font-bold text-amber-900 dark:text-amber-100">{reviewDueCounts.seven + reviewDueCounts.thirty}</p>
                    <p className="text-sm text-amber-800/80 dark:text-amber-200/80">
                        7일째 복습: {reviewDueCounts.seven}문항 · 30일째 복습: {reviewDueCounts.thirty}문항
                    </p>
                </div>
                <div className="p-4 rounded-xl bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-700">
                    <h4 className="text-sm font-semibold text-purple-800 dark:text-purple-200 mb-2">AI 변형 문제</h4>
                    <p className="text-sm text-purple-800/80 dark:text-purple-200/80">
                        오답 노트 기반으로 조건을 바꾼 문제를 생성해 실전 감각을 높여보세요.
                    </p>
                    <button
                        onClick={() => navigate('ai-variant-generator')}
                        className="mt-3 w-full bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold py-2 rounded-lg"
                    >
                        AI 변형 문제 생성
                    </button>
                </div>
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                    <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200 mb-2">동기 부여 메시지</h4>
                    <p className="text-sm text-slate-600 dark:text-slate-300">{motivationalMessage}</p>
                </div>
            </div>
        </div>
    );
};

export default DashboardScreen;
