import React, { useState, useEffect, useCallback } from 'react';
import { Screen, LearningProgress, AuthSession } from '../types';
import { quizApi } from '../services/quizApi';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Certification, getSubjectsByCertification } from '../constants';
import { useMediaQuery } from '../hooks/useMediaQuery';

interface DashboardScreenProps {
    navigate: (screen: Screen) => void;
    startMockTest: () => void;
    session: AuthSession;
    certification: Certification;
}

const DashboardScreen: React.FC<DashboardScreenProps> = ({ navigate, startMockTest, session, certification }) => {
    const [progress, setProgress] = useState<LearningProgress | null>(null);
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

    return (
        <div className="space-y-8">
            <div>
                <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-200 mb-4">학습 진행율 ({certification})</h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="bg-slate-100 dark:bg-slate-700 p-6 rounded-lg shadow-md text-center">
                        <h3 className="text-lg font-semibold text-slate-600 dark:text-slate-300">완성도</h3>
                        <p className="text-4xl font-bold text-blue-500">{completionRate.toFixed(1)}%</p>
                        <p className="text-slate-500 dark:text-slate-400">{solvedQuestions} / {totalQuestions} 문제</p>
                    </div>
                    <div className="bg-slate-100 dark:bg-slate-700 p-6 rounded-lg shadow-md text-center">
                        <h3 className="text-lg font-semibold text-slate-600 dark:text-slate-300">정확도</h3>
                        <p className="text-4xl font-bold text-green-500">
                            {accuracy.toFixed(1)}%
                        </p>
                        <p className="text-slate-500 dark:text-slate-400">전체 정답률</p>
                    </div>
                    <div className="bg-slate-100 dark:bg-slate-700 p-6 rounded-lg shadow-md text-center">
                        <h3 className="text-lg font-semibold text-slate-600 dark:text-slate-300">복습 항목</h3>
                        <p className="text-4xl font-bold text-red-500">{progress.totalWrongAnswers}</p>
                        <p className="text-slate-500 dark:text-slate-400">틀린 문제 (전체)</p>
                    </div>
                </div>
            </div>

            {filteredSubjectStats.length > 0 && (
                <div>
                    <h3 className="text-xl font-bold text-slate-800 dark:text-slate-200 mb-4">과목별 학습 진행율</h3>
                    <div className={`w-full h-72 bg-slate-100 dark:bg-slate-700 rounded-lg ${isMobile ? 'p-0 pt-4 pb-4' : 'p-4'}`}>
                        {/* Chart for subject progress */}
                        <ResponsiveContainer width="100%" height="100%">
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
            )}

            <div className="space-y-4 pt-4 border-t dark:border-slate-600">
                <div className="flex flex-col md:flex-row gap-4">
                    <button
                        onClick={() => navigate('subject-select')}
                        className="w-full md:flex-1 bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-4 rounded-lg transition-transform transform hover:scale-105"
                    >
                        학습하기
                    </button>
                    <button
                        onClick={startMockTest}
                        className="w-full md:flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-lg transition-transform transform hover:scale-105"
                    >
                        모의고사 시작
                    </button>
                    <button
                        onClick={() => navigate('wrong-note')}
                        className="w-full md:flex-1 bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-4 rounded-lg transition-transform transform hover:scale-105 disabled:bg-slate-500 disabled:cursor-not-allowed"
                        disabled={progress.totalWrongAnswers === 0}
                    >
                        오답 노트 학습 ({progress.totalWrongAnswers})
                    </button>
                </div>
            </div>
        </div>
    );
};

export default DashboardScreen;
