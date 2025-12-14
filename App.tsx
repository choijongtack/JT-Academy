import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { Screen, QuestionModel, AuthSession } from './types';
import DashboardScreen from './components/DashboardScreen';
import QuizScreen from './components/QuizScreen';
import WrongNoteScreen from './components/WrongNoteScreen';
import SubjectSelectionScreen from './components/SubjectSelectionScreen';
import AiVariantGeneratorScreen from './components/AiVariantGeneratorScreen';
import AdminQuestionManagementScreen from './components/AdminQuestionManagementScreen';
import LandingScreen from './components/LandingScreen';
import AuthScreen from './components/AuthScreen';
import { quizApi } from './services/quizApi';
import { supabase } from './services/supabaseClient';
import { isAdmin } from './services/authService';
import { useMediaQuery } from './hooks/useMediaQuery';
import { Certification, CERTIFICATIONS, getSubjectsByCertification } from './constants';

type PhaseHistoryEntry = {
  accuracy: number;
  date: string;
  totalQuestions: number;
  correctCount: number;
};

type SubjectPhaseStatus = {
  history: PhaseHistoryEntry[];
  ready: boolean;
};

type Phase1ResultPayload = {
  subject: string;
  accuracy: number;
  totalQuestions: number;
  correctCount: number;
  timestamp: string;
};


const App: React.FC = () => {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [currentScreen, setCurrentScreen] = useState<Screen>('dashboard');
  const [quizQuestions, setQuizQuestions] = useState<QuestionModel[]>([]);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [quizTitle, setQuizTitle] = useState('');
  const [quizReturnScreen, setQuizReturnScreen] = useState<Screen>('dashboard');
  const [selectedCertification, setSelectedCertification] = useState<Certification>('전기기사');

  const [initialSolvedRecords, setInitialSolvedRecords] = useState<Record<number, import('./types').UserQuizRecord>>({});
  const [isMockTest, setIsMockTest] = useState(false);
  const [isPhase1Mode, setIsPhase1Mode] = useState(false);
  const [showLanding, setShowLanding] = useState(true);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [phaseStatuses, setPhaseStatuses] = useState<Record<string, SubjectPhaseStatus>>({});
  const [phaseStatusReady, setPhaseStatusReady] = useState(false);
  const PHASE1_HISTORY_MAX = 5;
  const isMobile = useMediaQuery('(max-width: 768px)');
  const phaseStatusStorageKey = useMemo(() => {
    if (!session) return null;
    return `phase-status:${session.user.id}:${selectedCertification}`;
  }, [session, selectedCertification]);

  const subjectsForCert = useMemo(() => getSubjectsByCertification(selectedCertification), [selectedCertification]);
  const canStartPhase2 = useMemo(() => {
    if (subjectsForCert.length === 0) return false;
    return subjectsForCert.every(subject => phaseStatuses[subject]?.ready);
  }, [phaseStatuses, subjectsForCert]);

  const containerClasses = isMobile
    ? 'min-h-screen w-full px-4 py-4 flex flex-col items-center bg-slate-50 dark:bg-slate-900'
    : 'min-h-screen container mx-auto p-4 md:p-8 flex flex-col items-center bg-slate-50 dark:bg-slate-900';

  const headerWrapperClasses = isMobile ? 'w-full mb-6' : 'w-full max-w-4xl mb-8';
  // Reduced font size as requested (approx 2/3 of original)
  const headingClasses = `font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-500 to-teal-400 ${isMobile ? 'text-2xl' : 'text-3xl md:text-4xl'
    }`;

  const cardClasses = `w-full max-w-4xl bg-white dark:bg-slate-800 rounded-2xl shadow-xl ${isMobile ? 'p-4' : 'p-6 md:p-8'
    }`;
  const footerClasses = isMobile ? 'mt-6 text-center text-slate-500 text-xs' : 'mt-8 text-center text-slate-500 text-sm';

  // Load certification from localStorage on mount
  useEffect(() => {
    const savedCertification = localStorage.getItem('selectedCertification') as Certification;
    if (savedCertification && CERTIFICATIONS.includes(savedCertification)) {
      setSelectedCertification(savedCertification);
    }
  }, []);

  // Save certification to localStorage when it changes
  useEffect(() => {
    localStorage.setItem('selectedCertification', selectedCertification);
  }, [selectedCertification]);

  useEffect(() => {
    if (!phaseStatusStorageKey) {
      setPhaseStatuses({});
      setPhaseStatusReady(false);
      return;
    }
    setPhaseStatusReady(false);
    const raw = localStorage.getItem(phaseStatusStorageKey);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        setPhaseStatuses(parsed);
      } catch {
        setPhaseStatuses({});
      }
    } else {
      setPhaseStatuses({});
    }
    setPhaseStatusReady(true);
  }, [phaseStatusStorageKey]);

  useEffect(() => {
    if (!phaseStatusStorageKey || !phaseStatusReady) return;
    localStorage.setItem(phaseStatusStorageKey, JSON.stringify(phaseStatuses));
  }, [phaseStatuses, phaseStatusStorageKey, phaseStatusReady]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setIsCheckingSession(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (_event === 'SIGNED_OUT') {
        setCurrentScreen('dashboard');
        setQuizQuestions([]);
        setQuizTitle('');
        setInitialSolvedRecords({});
        setIsPhase1Mode(false);
        setPhaseStatuses({});
        setPhaseStatusReady(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const navigate = useCallback((screen: Screen) => {
    console.log('[App] navigating to:', screen);
    setCurrentScreen(screen);
  }, []);

  const startMockTest = useCallback(async () => {
    if (!session) return;
    if (!canStartPhase2) {
      alert('Phase 1 목표(과목별 70% 이상 3회)를 달성하면 CBT 모의고사를 진행할 수 있습니다.');
      return;
    }
    setQuizTitle("모의고사");
    setIsMockTest(true);
    setIsPhase1Mode(false);
    const questions = await quizApi.generateMockTest(100, selectedCertification);
    setQuizQuestions(questions);
    setInitialSolvedRecords({});
    setQuizReturnScreen('dashboard');
    setCurrentScreen('quiz');
  }, [session, selectedCertification, canStartPhase2]);

  const startWrongAnswerReview = useCallback(async (questionId: number) => {
    if (!session) return;
    setQuizTitle("오답노트 복습");
    setIsPhase1Mode(false);
    const wrongAnswers = await quizApi.getWrongAnswers(session.user.id);
    const wrongQuestionIds = wrongAnswers.map(wa => wa.questionId);

    const specificQuestion = await quizApi.getQuestionById(questionId);

    const otherWrongQuestions = await Promise.all(
      wrongQuestionIds
        .filter(id => id !== questionId)
        .map(id => quizApi.getQuestionById(id))
    );

    const questions = [
      specificQuestion,
      ...otherWrongQuestions
    ].filter((q): q is QuestionModel => q !== undefined);

    if (questions.length > 0) {
      setQuizQuestions(questions);
      setInitialSolvedRecords({});
      setQuizReturnScreen('wrong-note');
      setCurrentScreen('quiz');
    }
  }, [session]);

  const startSubjectQuiz = useCallback(async (subject: string, topic?: string) => {
    if (!session) return;
    setQuizTitle(topic ? `${subject} - ${topic}` : subject);
    setIsMockTest(false);
    setIsPhase1Mode(false);

    // Load questions
    const questions = await quizApi.loadQuestions({ subject, topic, certification: selectedCertification });

    // Load user records for these questions to resume learning
    const allRecords = await quizApi.getAllRecords(session.user.id);
    const recordMap: Record<number, import('./types').UserQuizRecord> = {};

    // Filter records relevant to loaded questions
    const questionIds = new Set(questions.map(q => q.id));
    allRecords.forEach(record => {
      if (questionIds.has(record.questionId)) {
        recordMap[record.questionId] = record;
      }
    });

    const solvedIds = new Set(Object.keys(recordMap).map(id => Number(id)));
    const unsolvedQuestions = questions.filter(q => !solvedIds.has(q.id));
    const solvedQuestions = questions.filter(q => solvedIds.has(q.id));
    const reorderedQuestions = [...unsolvedQuestions, ...solvedQuestions];

    setQuizQuestions(reorderedQuestions);
    setInitialSolvedRecords(recordMap);
    setQuizReturnScreen('subject-select');
    setCurrentScreen('quiz');
  }, [session, selectedCertification]);

  const startPhase1SubjectQuiz = useCallback(async (subject: string) => {
    if (!session) return;
    setQuizTitle(`${subject} 기초다지기`);
    setIsMockTest(false);
    setIsPhase1Mode(true);

    let history: number[][] = [];
    try {
      history = await quizApi.getPhase1History(
        session.user.id,
        selectedCertification,
        subject,
        PHASE1_HISTORY_MAX
      );
    } catch (error) {
      console.error('Failed to load Phase 1 history:', error);
    }

    const excludeQuestionIds = Array.from(new Set(history.flatMap(entry => entry)));
    const questions = await quizApi.getQuestionsForPhase1({
      subject,
      certification: selectedCertification,
      excludeQuestionIds
    });
    setQuizQuestions(questions);
    setInitialSolvedRecords({});
    setQuizReturnScreen('subject-select');
    setCurrentScreen('quiz');

    if (questions.length > 0) {
      const newEntry = questions.map(q => q.id);
      try {
        await quizApi.savePhase1History(
          session.user.id,
          selectedCertification,
          subject,
          newEntry
        );
      } catch (error) {
        console.error('Failed to save Phase 1 history:', error);
      }
    }
  }, [session, selectedCertification]);

  const handlePhase1Result = useCallback((result: Phase1ResultPayload) => {
    if (!result.subject || result.subject === 'Phase 1') return;
    setPhaseStatuses(prev => {
      const prevState = prev[result.subject] || { history: [], ready: false };
      const updatedHistory = [
        {
          accuracy: result.accuracy,
          date: result.timestamp,
          totalQuestions: result.totalQuestions,
          correctCount: result.correctCount
        },
        ...prevState.history
      ].slice(0, 5);

      const recentThree = updatedHistory.slice(0, 3);
      const ready = recentThree.length === 3 && recentThree.every(entry => entry.accuracy >= 70);

      return {
        ...prev,
        [result.subject]: {
          history: updatedHistory,
          ready
        }
      };
    });
  }, []);

  const handleStartVariantQuiz = useCallback((questions: QuestionModel[]) => {
    setIsPhase1Mode(false);
    setQuizTitle("AI 응용 문제 풀기");
    setQuizQuestions(questions);
    setInitialSolvedRecords({});
    setQuizReturnScreen('dashboard');
    setCurrentScreen('quiz');
  }, []);

  const handleQuizFinish = useCallback(() => {
    setIsPhase1Mode(false);
    navigate(quizReturnScreen);
  }, [navigate, quizReturnScreen]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  const renderScreen = () => {
    if (!session) return null;

    switch (currentScreen) {
      case 'quiz':
        return <QuizScreen
          questions={quizQuestions}
          onFinish={handleQuizFinish}
          title={quizTitle}
          session={session}
          onStartVariantQuiz={handleStartVariantQuiz}
          initialSolvedRecords={initialSolvedRecords}
          examDuration={isMockTest ? 150 : undefined}
          isPhase1={isPhase1Mode}
          onPhase1Complete={handlePhase1Result}
        />;
      case 'wrong-note':
        return <WrongNoteScreen navigate={navigate} startReview={startWrongAnswerReview} session={session} onStartVariantQuiz={handleStartVariantQuiz} />;
      case 'subject-select':
        return <SubjectSelectionScreen
          navigate={navigate}
          onSelectSubject={startSubjectQuiz}
          onStartPhase1={startPhase1SubjectQuiz}
          certification={selectedCertification}
        />;
      case 'ai-variant-generator':
        return <AiVariantGeneratorScreen navigate={navigate} session={session} certification={selectedCertification} onQuestionsUpdated={() => {
        }} />;
      case 'admin-questions':
        return <AdminQuestionManagementScreen navigate={navigate} session={session} />;
      case 'dashboard':
      default:
        return <DashboardScreen
          navigate={navigate}
          startMockTest={startMockTest}
          session={session}
          certification={selectedCertification}
          phaseStatuses={phaseStatuses}
          canStartPhase2={canStartPhase2}
        />;
    }
  };

  if (isCheckingSession) {
    return (
      <div className={`${containerClasses} justify-center`}>
        <p>세션 확인 중...</p>
      </div>
    );
  }

  if (!session) {
    if (showLanding) {
      return (
        <LandingScreen
          onNavigateToAuth={(mode) => {
            setAuthMode(mode);
            setShowLanding(false);
          }}
        />
      );
    }

    return (
      <div className={containerClasses}>
        <header className={headerWrapperClasses}>
          <div className="text-center">
            <h1 className={headingClasses}>
              JT Academy
            </h1>
            <p className="text-slate-500 dark:text-slate-400 mt-2">AI 기반 학습 파트너</p>
          </div>
        </header>
        <main className={cardClasses}>
          <AuthScreen initialMode={authMode} />
          <div className="mt-6 text-center">
            <button
              onClick={() => setShowLanding(true)}
              className="text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 flex items-center justify-center mx-auto gap-1"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              메인 화면으로 돌아가기
            </button>
          </div>
        </main>
        <footer className={footerClasses}>
          <p>&copy; {new Date().getFullYear()} AI Learning Tool. All rights reserved.</p>
        </footer>
      </div>
    );
  }

  return (
    <div className={containerClasses}>
      <header className={headerWrapperClasses}>
        <div className="flex flex-col md:flex-row justify-between items-center mb-4 gap-4">
          {/* Left: Certification Selector */}
          <div className="w-full md:w-auto flex justify-start">
            <select
              value={selectedCertification}
              onChange={(e) => setSelectedCertification(e.target.value as Certification)}
              className="bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 rounded-lg px-4 py-2 text-base md:text-lg font-semibold hover:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors shadow-sm min-w-[220px]"
            >
              {CERTIFICATIONS.map((cert) => (
                <option key={cert} value={cert}>
                  {cert}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="text-center mb-4">
          <h1 className={headingClasses}>
            {selectedCertification} 학습하기
          </h1>
          <p className="text-slate-500 dark:text-slate-400 mt-2">AI 기반 학습 파트너</p>
        </div>
      </header>
      <main className={cardClasses}>
        {/* Actions moved to Card */}
        <div className="w-full flex justify-end items-center gap-3 text-sm mb-6 border-b pb-4 dark:border-slate-700">
          {isAdmin(session) && (
            <>
              <button
                onClick={() => navigate('admin-questions')}
                className="bg-purple-500 hover:bg-purple-600 text-white font-semibold py-1 px-3 rounded-md transition-colors flex items-center"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                문제 관리
              </button>
              <button
                onClick={() => {
                  console.log('[App] Upload button clicked');
                  navigate('ai-variant-generator');
                }}
                className="bg-yellow-500 hover:bg-yellow-600 text-white font-semibold py-1 px-3 rounded-md transition-colors flex items-center"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                문제 UPLOAD
              </button>
            </>
          )}
          <span className={`text-slate-600 dark:text-slate-300${isMobile ? ' hidden' : ''}`}>
            {session.user.email}
          </span>
          {currentScreen === 'quiz' ? (
            <button onClick={() => { setIsPhase1Mode(false); navigate(quizReturnScreen); }} className="bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-semibold py-1 px-3 rounded-md transition-colors">
              퀴즈 종료
            </button>
          ) : currentScreen === 'subject-select' || currentScreen === 'wrong-note' || currentScreen === 'ai-variant-generator' || currentScreen === 'admin-questions' ? (
            <button onClick={() => navigate('dashboard')} className="bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-semibold py-1 px-3 rounded-md transition-colors">
              메인으로
            </button>
          ) : (
            <button onClick={handleLogout} className="bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-semibold py-1 px-3 rounded-md transition-colors">
              로그아웃
            </button>
          )}
        </div>
        {renderScreen()}
      </main>
      <footer className={footerClasses}>
        <p>&copy; {new Date().getFullYear()} AI Learning Tool. All rights reserved.</p>
      </footer>
    </div>
  );
};

export default App;
