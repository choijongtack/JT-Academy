import React, { useState, useEffect } from 'react';
import { Screen, TopicStats } from '../types';
import { quizApi } from '../services/quizApi';
import { supabase } from '../services/supabaseClient';
import { SUBJECT_TOPICS, getSubjectsByCertification, Certification } from '../constants';


interface SubjectSelectionScreenProps {
  onSelectSubject: (subject: string, topic?: string) => void;
  onStartPhase1: (subject: string) => void;
  navigate: (screen: Screen) => void;
  certification: Certification;
}

const SubjectSelectionScreen: React.FC<SubjectSelectionScreenProps> = ({ onSelectSubject, onStartPhase1, navigate, certification }) => {
  const [selectedSubject, setSelectedSubject] = useState<string | null>(null);
  const [topicStats, setTopicStats] = useState<TopicStats[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Study Plan State
  const [activePlan, setActivePlan] = useState<import('../types').StudyPlan | null>(null);
  const [checkingPlan, setCheckingPlan] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session) {
        const plan = await quizApi.getActiveStudyPlan(session.user.id, certification);
        setActivePlan(plan);
      }
      setCheckingPlan(false);
    });
  }, [certification]);

  const handleStartCourse = async (type: '60_day' | '90_day') => {
    console.log('[SubjectSelection] handleStartCourse', type, certification);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      console.error('No session');
      return;
    }

    try {
      const newPlan = await quizApi.createStudyPlan(session.user.id, type, certification);
      console.log('New plan created:', newPlan);
      setActivePlan(newPlan);
      // Navigate to routine screen immediately
      navigate('course-routine');
    } catch (err) {
      console.error('Course creation error:', err);
      alert("코스 생성 실패: " + err);
    }
  };


  // Get subjects for the selected certification
  const subjects = getSubjectsByCertification(certification);

  useEffect(() => {
    if (selectedSubject) {
      loadTopics(selectedSubject);
    }
  }, [selectedSubject]);

  const loadTopics = async (subject: string) => {
    setIsLoading(true);
    try {
      const stats = await quizApi.getTopicStatistics(subject, certification);
      setTopicStats(stats);
    } catch (error) {
      console.error('Failed to load topics:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubjectClick = (subject: string) => {
    setSelectedSubject(subject);
  };

  const handleTopicClick = (topic: string) => {
    if (selectedSubject) {
      onSelectSubject(selectedSubject, topic);
    }
  };

  const handleBackToSubjects = () => {
    setSelectedSubject(null);
    setTopicStats([]);
  };

  if (selectedSubject) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-4">
            <button
              onClick={handleBackToSubjects}
              className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
            >
              <svg className="w-6 h-6 text-slate-600 dark:text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-200">{selectedSubject} - 주제 선택</h2>
          </div>
        </div>

        {isLoading ? (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
            <p className="mt-4 text-slate-600 dark:text-slate-400">주제 분석 중...</p>
          </div>
        ) : (
          <div className="grid gap-4">
            <button
              onClick={() => onStartPhase1(selectedSubject)}
              className="w-full text-left p-4 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors shadow-sm"
            >
              <div className="flex items-center justify-between">
                <span className="font-bold text-emerald-700 dark:text-emerald-300">기초다지기</span>
                <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-200">Phase 1 · 20문항</span>
              </div>
              <p className="mt-1 text-sm text-emerald-700/80 dark:text-emerald-200/80">과목별 기본기를 20문항으로 빠르게 다집니다.</p>
            </button>

            <button
              onClick={() => onSelectSubject(selectedSubject)}
              className="w-full text-left p-4 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors shadow-sm"
            >
              <span className="font-bold text-blue-700 dark:text-blue-300">전체 문제 풀기</span>
            </button>

            {(SUBJECT_TOPICS[selectedSubject] || []).map((topicName, index) => {
              const stat = topicStats.find(s => s.topicCategory === topicName);
              const questionCount = stat?.questionCount || 0;
              const years = stat?.years || [];

              return (
                <button
                  key={index}
                  onClick={() => questionCount > 0 && handleTopicClick(topicName)}
                  disabled={questionCount === 0}
                  className={`w-full text-left p-4 rounded-lg border transition-all shadow-sm group ${questionCount === 0
                    ? 'bg-slate-50 dark:bg-slate-800/50 border-slate-100 dark:border-slate-800 cursor-not-allowed opacity-60'
                    : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-blue-400 dark:hover:border-blue-500'
                    }`}
                >
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-3">
                      <span className={`font-semibold text-lg ${questionCount === 0 ? 'text-slate-400 dark:text-slate-600' : 'text-slate-700 dark:text-slate-200'
                        }`}>
                        {topicName}
                      </span>
                      {questionCount >= 5 && (
                        <span className="px-2 py-1 bg-red-100 text-red-700 text-xs font-bold rounded-full border border-red-200">
                          ⭐ 고빈도 ({questionCount}문제)
                        </span>
                      )}
                      {questionCount >= 3 && questionCount < 5 && (
                        <span className="px-2 py-1 bg-orange-100 text-orange-700 text-xs font-bold rounded-full border border-orange-200">
                          중빈도 ({questionCount}문제)
                        </span>
                      )}
                      {questionCount > 0 && questionCount < 3 && (
                        <span className="px-2 py-1 bg-slate-100 text-slate-600 text-xs font-medium rounded-full border border-slate-200">
                          {questionCount}문제
                        </span>
                      )}
                      {questionCount === 0 && (
                        <span className="px-2 py-1 bg-slate-50 text-slate-400 text-xs font-medium rounded-full border border-slate-100">
                          0문제
                        </span>
                      )}
                    </div>
                    <div className="text-slate-400 group-hover:text-blue-500 transition-colors">
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </div>
                  <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                    {years.length > 0 ? `출제 연도: ${years.sort((a, b) => (b as number) - (a as number)).join(', ')}` : '출제 기록 없음'}
                  </div>
                </button>
              );
            })}

            {/* Other / Unclassified Category */}
            {(() => {
              const knownTopics = SUBJECT_TOPICS[selectedSubject] || [];
              const otherStats = topicStats.filter(s => !knownTopics.includes(s.topicCategory));
              const otherCount = otherStats.reduce((sum, s) => sum + s.questionCount, 0);
              const otherYears = Array.from(new Set(otherStats.flatMap(s => s.years)));

              if (otherCount > 0) {
                return (
                  <button
                    onClick={() => handleTopicClick('기타')}
                    className="w-full text-left p-4 rounded-lg border transition-all shadow-sm group bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-blue-400 dark:hover:border-blue-500"
                  >
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-3">
                        <span className="font-semibold text-lg text-slate-700 dark:text-slate-200">
                          기타 (미분류)
                        </span>
                        <span className="px-2 py-1 bg-gray-100 text-gray-700 text-xs font-medium rounded-full border border-gray-200">
                          {otherCount}문제
                        </span>
                      </div>
                      <div className="text-slate-400 group-hover:text-blue-500 transition-colors">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </div>
                    </div>
                    <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                      {otherYears.length > 0 ? `출제 연도: ${otherYears.sort((a, b) => (b as number) - (a as number)).join(', ')}` : '출제 기록 없음'}
                    </div>
                  </button>
                );
              }
              return null;
            })()}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-200">과목 선택</h2>
        <button
          onClick={() => navigate('dashboard')}
          className="text-blue-500 hover:underline"
        >
          학습 진행율로 돌아가기
        </button>
      </div>

      {/* Course Manager Section */}
      <div className="bg-gradient-to-r from-slate-900 to-slate-800 dark:from-slate-800 dark:to-slate-900 rounded-2xl p-6 text-white shadow-lg border border-slate-700">
        <div className="flex justify-between items-start mb-4">
          <div>
            <h3 className="text-xl font-bold flex items-center gap-2">
              🎯 합격 패스 매니저 <span className="text-xs bg-yellow-500 text-slate-900 px-2 py-0.5 rounded font-bold">{certification}</span>
            </h3>
            <p className="text-slate-400 text-sm mt-1">
              {activePlan
                ? `${activePlan.courseType === '60_day' ? '60일' : '90일'} 완성 코스 진행 중입니다.`
                : "시험일까지 남은 기간에 맞춰 맞춤형 커리큘럼을 시작하세요."}
            </p>
          </div>
          {activePlan && (
            <div className="text-right">
              <p className="text-2xl font-bold text-emerald-400">Day {activePlan.currentDay}</p>
              <p className="text-xs text-slate-400">/ {activePlan.courseType === '60_day' ? '60' : '90'}</p>
            </div>
          )}
        </div>

        {!checkingPlan && !activePlan && (
          <div className="grid grid-cols-2 gap-4 mt-4">
            <button
              onClick={() => handleStartCourse('60_day')}
              className="bg-white/10 hover:bg-white/20 border border-white/20 rounded-xl p-4 transition-all text-left group"
            >
              <div className="font-bold text-lg group-hover:text-emerald-300 transition-colors">⚡ 60일 단기 완성</div>
              <p className="text-xs text-slate-400 mt-1">하루 2시간 집중 코스. 핵심 위주로 빠르게 정리합니다.</p>
            </button>
            <button
              onClick={() => handleStartCourse('90_day')}
              className="bg-white/10 hover:bg-white/20 border border-white/20 rounded-xl p-4 transition-all text-left group"
            >
              <div className="font-bold text-lg group-hover:text-blue-300 transition-colors">📅 90일 정석 완성</div>
              <p className="text-xs text-slate-400 mt-1">하루 1시간 꾸준히. 기초부터 실전까지 완벽하게.</p>
            </button>
          </div>
        )}

        {activePlan && (
          <div className="mt-4">
            <button
              onClick={() => navigate('course-routine')}
              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 px-4 rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              오늘의 루틴 시작하기 (Day {activePlan.currentDay})
            </button>
            <div className="mt-2 text-center">
              <button
                onClick={async () => {
                  if (window.confirm('정말로 현재 코스를 초기화하시겠습니까? 진행 데이터는 보존되지만 코스는 중단됩니다.')) {
                    try {
                      await quizApi.resetStudyPlan(activePlan.id);
                      setActivePlan(null);
                    } catch (e) {
                      console.error("Reset error:", e);
                      alert('초기화 중 오류가 발생했습니다: ' + (e as Error).message);
                    }
                  }
                }}
                className="text-xs text-slate-500 hover:text-red-400 underline"
              >
                코스 초기화 및 재설정
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {subjects.map((subject, index) => (
          <button
            key={index}
            onClick={() => handleSubjectClick(subject)}
            className="w-full text-left p-6 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-blue-400 dark:hover:border-blue-500 hover:shadow-md transition-all duration-300"
          >
            <div className="flex justify-between items-center">
              <span className="font-bold text-lg text-slate-700 dark:text-slate-200">{index + 1}. {subject}</span>
              <svg className="w-6 h-6 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </button>
        ))}
      </div>
    </div >
  );
};

export default SubjectSelectionScreen;
