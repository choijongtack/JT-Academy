import React, { useState, useEffect } from 'react';
import { Screen, StudyPlan, DailyStudyLog, QuestionModel, AuthSession } from '../types';
import { quizApi } from '../services/quizApi';
import { getSubjectsByCertification } from '../constants';

interface CourseRoutineScreenProps {
    session: AuthSession;
    plan?: StudyPlan; // Make optional
    onNavigate: (screen: Screen) => void;
    onStartQuiz: (questions: QuestionModel[], title: string, routineTask?: { planId: string, logId: string, type: 'reading' | 'review' }) => void;
    certification: string; // Add certification prop
}

const CourseRoutineScreen: React.FC<CourseRoutineScreenProps> = ({ session, plan: initialPlan, onNavigate, onStartQuiz, certification }) => {
    const [plan, setPlan] = useState<StudyPlan | undefined>(initialPlan);
    const [dailyLog, setDailyLog] = useState<DailyStudyLog | null>(null);
    const [loading, setLoading] = useState(true);
    const [dailyStats, setDailyStats] = useState({ newCount: 0, reviewCount: 0 });

    // Fetch plan if not provided
    useEffect(() => {
        const fetchPlan = async () => {
            if (!plan) {
                try {
                    const fetchedPlan = await quizApi.getActiveStudyPlan(session.user.id, certification as any);
                    if (fetchedPlan) {
                        setPlan(fetchedPlan);
                    } else {
                        // No active plan, redirect to selection
                        alert("진행 중인 코스가 없습니다.");
                        onNavigate('subject-select');
                    }
                } catch (e) {
                    console.error("Failed to fetch plan", e);
                }
            }
        };
        fetchPlan();
    }, [plan, session.user.id, certification]);

    // Initialize Daily Routine (Only run when plan is available)
    useEffect(() => {
        if (!plan) return;
        setDailyLog(null); // Reset log when plan changes to prevent stale UI

        const initRoutine = async () => {
            try {
                let log = await quizApi.getDailyRoutine(plan.id, plan.currentDay);
                console.log('[CourseRoutine] Plan ID:', plan.id, 'Day:', plan.currentDay);

                // --- Advanced Dynamic Calculation Logic ---
                const totalQuestions = await quizApi.getTotalQuestionCount(plan.certification);
                const planDays = plan.courseType === '60_day' ? 60 : 90;

                // ... logic ...

                if (!log) {
                    const allSubjects = getSubjectsByCertification(plan.certification as any);
                    const subjectIndex = (plan.currentDay - 1) % allSubjects.length;
                    const todaysSubject = allSubjects[subjectIndex];

                    log = await quizApi.startDailyRoutine(plan.id, plan.currentDay, [todaysSubject]);
                    console.log('[CourseRoutine] Created new log:', log);
                } else {
                    console.log('[CourseRoutine] Loaded existing log:', log);
                }
                setDailyLog(log);
                const REPETITION_COEFFICIENT = 3.0;

                const dailyCapacity = Math.ceil((totalQuestions * REPETITION_COEFFICIENT) / planDays);

                const progress = plan.currentDay / planDays;
                const learningCutoff = 0.8;

                let newRatio = 0;

                if (progress < learningCutoff) {
                    // User Request: 60% New Concept, 40% Review(+Supplement)
                    // We calculate capacity first, then split it.

                    const newCount = Math.ceil(dailyCapacity * 0.6);
                    const reviewCount = Math.floor(dailyCapacity * 0.4);

                    setDailyStats({ newCount, reviewCount });
                } else {
                    // Final Phase: 100% Review
                    setDailyStats({ newCount: 0, reviewCount: dailyCapacity });
                }

                setDailyStats(prev => ({
                    newCount: Math.max(0, prev.newCount),
                    reviewCount: Math.max(10, prev.reviewCount)
                }));
                // Reverted Logic: limiting review count reduced study volume too much.
                // We will fill the gap with "Reinforcement" questions instead.

                if (!log) {
                    const allSubjects = getSubjectsByCertification(plan.certification as any);
                    const subjectIndex = (plan.currentDay - 1) % allSubjects.length;
                    const todaysSubject = allSubjects[subjectIndex];

                    log = await quizApi.startDailyRoutine(plan.id, plan.currentDay, [todaysSubject]);
                    console.log('[CourseRoutine] Created new log:', log);
                } else {
                    console.log('[CourseRoutine] Loaded existing log:', log);
                }
                setDailyLog(log);
            } catch (err) {
                console.error("Failed to init routine", err);
            } finally {
                setLoading(false);
            }
        };
        initRoutine();
    }, [plan]);

    const handleStartReading = async () => {
        if (!dailyLog || !plan) return;
        const subject = dailyLog.targetSubjects[0];


        // Load dynamically calculated number of questions
        // If newCount is 0 (Final Phase), effectively skip or just do a small random set? 
        // UI hides button if count is 0 ideally, but for safety:
        const count = dailyStats.newCount > 0 ? dailyStats.newCount : 5;

        // Load from API
        // Note: loadQuestions loads randomly. In real app, we need 'unseen' filter.
        const questions = await quizApi.loadQuestions({ subject, certification: plan.certification });

        const sessionQuestions = questions.sort(() => 0.5 - Math.random()).slice(0, count);

        // Pass task context to allow completion on finish
        onStartQuiz(
            sessionQuestions,
            `Day ${plan.currentDay}: ${subject} 개념 학습`,
            { planId: plan.id, logId: dailyLog.id, type: 'reading' }
        );
    };

    const handleStartReview = async () => {
        if (!dailyLog || !plan) return;
        const wrongAnswers = await quizApi.getWrongAnswers(session.user.id);

        const targetCount = dailyStats.reviewCount;

        // 1. Get Wrong Answers first
        const reviewIds = wrongAnswers.slice(0, targetCount).map(w => w.questionId);
        let questions: QuestionModel[] = [];

        for (const id of reviewIds) {
            const q = await quizApi.getQuestionById(id);
            if (q) questions.push(q);
        }

        // 2. Fill Gap with "Reinforcement" (Random from current subject) if not enough wrong answers
        // This ensures the user maintains the high daily study volume (Repetition).
        if (questions.length < targetCount) {
            const shortfall = targetCount - questions.length;
            const subject = dailyLog.targetSubjects[0]; // Fallback to current subject for drill

            // Fetch extras
            const extraQs = await quizApi.loadQuestions({ subject, certification: plan.certification });
            // Filter out duplicates if possible (simple check)
            const existingIds = new Set(questions.map(q => q.id));
            const extras = extraQs
                .filter(q => !existingIds.has(q.id))
                .sort(() => 0.5 - Math.random()) // Shuffle
                .slice(0, shortfall);

            questions.push(...extras);

            if (questions.length > 0) {
                // Inform user nicely? Or just let them study.
                // Ideally a Toast, but relying on Quiz Title is subtle enough.
            }
        }

        if (questions.length === 0) {
            // Should rarely happen given fallback, but safety net
            alert("복습할 문항을 가져올 수 없습니다.");
            return;
        }

        const title = reviewIds.length < targetCount
            ? `Day ${plan.currentDay}: 오답 복습 + 핵심 보충 (${questions.length}문항)`
            : `Day ${plan.currentDay}: 오답 복습`;

        onStartQuiz(
            questions,
            title,
            { planId: plan.id, logId: dailyLog.id, type: 'review' }
        );
    };

    const handleCompleteDay = async () => {
        if (!plan) return;
        await quizApi.completeDay(plan.id, plan.currentDay);
        onNavigate('subject-select'); // Go back to refresh
    };

    if (loading || !dailyLog || !plan) return <div className="p-8 text-center text-slate-500">
        <div className="animate-pulse">오늘의 학습량을 계산하고 있습니다...</div>
    </div>;

    const isMockDay = plan.currentDay % 7 === 0;

    return (
        <div className="max-w-4xl mx-auto p-4 space-y-6">
            <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-xl border border-slate-200 dark:border-slate-700">
                <div className="flex justify-between items-center mb-6">
                    <div>
                        <span className="text-sm font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-3 py-1 rounded-full">
                            {plan.courseType === '60_day' ? '60일 완성' : '90일 완성'}
                        </span>
                        <h1 className="text-3xl font-bold text-slate-900 dark:text-white mt-2">
                            Day {plan.currentDay} <span className="text-slate-400 font-normal">/ {plan.courseType === '60_day' ? 60 : 90}</span>
                        </h1>
                    </div>
                    <div className="text-right">
                        <p className="text-slate-500 text-sm">Today's Target</p>
                        <p className="font-bold text-xl text-slate-800 dark:text-slate-200">
                            {isMockDay ? '실전 모의고사' : dailyLog.targetSubjects.join(', ')}
                        </p>
                    </div>
                </div>

                {/* Stats Summary Card */}
                <div className="bg-slate-50 dark:bg-slate-900/50 rounded-xl p-4 mb-6 flex justify-around text-center border border-slate-100 dark:border-slate-700">
                    <div>
                        <p className="text-xs text-slate-500">오늘의 학습량</p>
                        <p className="text-xl font-bold text-emerald-600">{dailyStats.newCount + dailyStats.reviewCount}문항</p>
                    </div>
                    <div>
                        <p className="text-xs text-slate-500">신규 : 복습</p>
                        <p className="text-xl font-bold text-blue-500">{Math.round((dailyStats.newCount / (dailyStats.newCount + dailyStats.reviewCount || 1)) * 100)} : {Math.round((dailyStats.reviewCount / (dailyStats.newCount + dailyStats.reviewCount || 1)) * 100)}</p>
                    </div>
                    <div>
                        <p className="text-xs text-slate-500">현재 페이스</p>
                        <p className="text-xl font-bold text-slate-700 dark:text-slate-300">
                            {plan.currentDay > (plan.courseType === '60_day' ? 48 : 72) ? '마무리 단계 🔥' : '개념 완성 📖'}
                        </p>
                    </div>
                </div>

                <div className="grid gap-4">
                    {/* Step 1: Learning */}
                    {dailyStats.newCount > 0 && (
                        <div className={`p-4 rounded-xl border ${dailyLog.completedReading ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-slate-200'} transition-all`}>
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-4">
                                    <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold ${dailyLog.completedReading ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-600'}`}>1</div>
                                    <div>
                                        <h3 className="font-bold text-lg dark:text-slate-200">개념 학습 ({dailyStats.newCount}문항)</h3>
                                        <p className="text-sm text-slate-500">{dailyLog.targetSubjects.join(', ')} 핵심 문제</p>
                                    </div>
                                </div>
                                <button
                                    onClick={handleStartReading}
                                    disabled={dailyLog.completedReading}
                                    className={`px-4 py-2 rounded-lg font-bold ${dailyLog.completedReading ? 'text-emerald-700 bg-emerald-100' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
                                >
                                    {dailyLog.completedReading ? '완료됨' : '시작하기'}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Step 2: Review */}
                    <div className={`p-4 rounded-xl border ${dailyLog.completedReview ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-slate-200'} transition-all`}>
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-4">
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold ${dailyLog.completedReview ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-600'}`}>2</div>
                                <div>
                                    <h3 className="font-bold text-lg dark:text-slate-200">오답 복습 및 보충 학습 ({dailyStats.reviewCount}문항)</h3>
                                    <p className="text-sm text-slate-500">오답 우선 배정 후 부족분은 보충 학습으로 채워집니다.</p>
                                </div>
                            </div>
                            <button
                                onClick={handleStartReview}
                                disabled={dailyLog.completedReview}
                                className={`px-4 py-2 rounded-lg font-bold ${dailyLog.completedReview ? 'text-emerald-700 bg-emerald-100' : 'bg-purple-600 text-white hover:bg-purple-700'}`}
                            >
                                {dailyLog.completedReview ? '완료됨' : '시작하기'}
                            </button>
                        </div>
                    </div>

                    {/* Final: Complete Day */}
                    {(dailyLog.completedReading || dailyStats.newCount === 0) && dailyLog.completedReview && (
                        <div className="mt-4 animate-fade-in">
                            <button
                                onClick={handleCompleteDay}
                                className="w-full py-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold rounded-xl shadow-lg hover:shadow-xl transform hover:-translate-y-1 transition-all"
                            >
                                Day {plan.currentDay} 완료하고 다음 날로 이동 🎉
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default CourseRoutineScreen;
