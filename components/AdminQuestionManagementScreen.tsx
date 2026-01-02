import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { QuestionModel, AuthSession } from '../types';
import { quizApi } from '../services/quizApi';
import { parseAnswerSheetFromImage, generateExplanationForAnswer } from '../services/geminiService';
import { supabase } from '../services/supabaseClient';
import FormattedText from './FormattedText';
import { isAdmin } from '../services/authService';
import { CERTIFICATIONS, CERTIFICATION_SUBJECTS, SUBJECT_TOPICS } from '../constants';

const normalizeKey = (value?: string | null) => (value ?? '').replace(/\s+/g, ' ').trim();

const buildSubjectOrderMap = (): Map<string, number> => {
    const map = new Map<string, number>();
    let index = 0;

    CERTIFICATIONS.forEach(certification => {
        const subjects = CERTIFICATION_SUBJECTS[certification] || [];
        subjects.forEach(subject => {
            const key = normalizeKey(subject);
            if (!key || map.has(key)) return;
            map.set(key, index);
            index += 1;
        });
    });

    return map;
};

const sortSubjectsByOrder = (subjects: string[], orderMap: Map<string, number>): string[] => {
    return [...subjects].sort((a, b) => {
        const aKey = normalizeKey(a);
        const bKey = normalizeKey(b);
        const aIndex = orderMap.get(aKey);
        const bIndex = orderMap.get(bKey);

        if (aIndex !== undefined && bIndex !== undefined) return aIndex - bIndex;
        if (aIndex !== undefined) return -1;
        if (bIndex !== undefined) return 1;
        return aKey.localeCompare(bKey);
    });
};

const buildCertificationSubjectOrderMap = (certification: string): Map<string, number> => {
    const map = new Map<string, number>();
    const subjects = CERTIFICATION_SUBJECTS[certification as keyof typeof CERTIFICATION_SUBJECTS] || [];
    subjects.forEach((subject, index) => {
        const key = normalizeKey(subject);
        if (!key) return;
        map.set(key, index);
    });
    return map;
};

const normalizeSubjectValue = (subject?: string | null): string => {
    const trimmed = normalizeKey(subject);
    return trimmed.length > 0 ? trimmed : '기타';
};

const normalizeTopicValue = (topic?: string | null): string => {
    const trimmed = normalizeKey(topic);
    return trimmed.length > 0 ? trimmed : '기타';
};

const preferNonEmptyText = (value?: string | null, fallback?: string | null): string => {
    const trimmed = (value ?? '').toString().trim();
    if (trimmed.length > 0) return trimmed;
    const fallbackTrimmed = (fallback ?? '').toString().trim();
    return fallbackTrimmed;
};

type ManagedQuestion = QuestionModel & {
    normalizedSubject: string;
    normalizedTopic: string;
};

type AnswerSheetEntry = {
    question_number: number;
    answer: string;
};

type AnswerMismatch = {
    questionId: number;
    questionNumber: number;
    expectedIndex: number;
    currentIndex: number;
    question: ManagedQuestion;
};

type PendingUpdate = {
    questionId: number;
    questionNumber: number;
    expectedIndex: number;
    currentIndex: number;
    newIndex: number;
    aiExplanation: string;
    hint: string;
    rationale: string;
    diagram_info?: QuestionModel['diagram_info'];
};

interface AdminQuestionManagementScreenProps {
    session: AuthSession;
    navigate: (screen: any) => void;
}

const AdminQuestionManagementScreen: React.FC<AdminQuestionManagementScreenProps> = ({ session, navigate }) => {
    const [questions, setQuestions] = useState<ManagedQuestion[]>([]);
    const [totalCount, setTotalCount] = useState<number | null>(null);
    const [availableYears, setAvailableYears] = useState<number[]>([]);
    const [availableExamSessions, setAvailableExamSessions] = useState<number[]>([]);
    const [availableSubjects, setAvailableSubjects] = useState<string[]>([]);
    const [availableTopicsBySubject, setAvailableTopicsBySubject] = useState<Record<string, string[]>>({});
    const [availableCertifications, setAvailableCertifications] = useState<string[]>([]);
    const [subjectsByCertification, setSubjectsByCertification] = useState<Record<string, string[]>>({});
    const [yearsByCertification, setYearsByCertification] = useState<Record<string, number[]>>({});
    const [sessionsByCertification, setSessionsByCertification] = useState<Record<string, number[]>>({});
    const [yearsByCertificationSubject, setYearsByCertificationSubject] = useState<Record<string, number[]>>({});
    const [topicsByCertificationSubject, setTopicsByCertificationSubject] = useState<Record<string, string[]>>({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);

    // Filters
    const [filterSubject, setFilterSubject] = useState<string>('');
    const [filterCertification, setFilterCertification] = useState<string>('');
    const [filterYear, setFilterYear] = useState<string>('');
    const [filterExamSession, setFilterExamSession] = useState<string>('');
    const [filterTopic, setFilterTopic] = useState<string>('');
    const [searchText, setSearchText] = useState('');
    const [scrollTop, setScrollTop] = useState(0);

    // Pagination
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 20;
    const rowHeight = 56;
    const listHeight = 520;

    // Edit mode
    const [editingId, setEditingId] = useState<number | null>(null);
    const [editForm, setEditForm] = useState<Partial<QuestionModel>>({});

    // Delete confirmation
    const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
    const [deleteWithStorage, setDeleteWithStorage] = useState(true);

    // Question detail modal
    const [selectedQuestion, setSelectedQuestion] = useState<ManagedQuestion | null>(null);
    const [answerSheetFile, setAnswerSheetFile] = useState<File | null>(null);
    const [answerSheetAnswers, setAnswerSheetAnswers] = useState<AnswerSheetEntry[]>([]);
    const [answerMismatches, setAnswerMismatches] = useState<AnswerMismatch[]>([]);
    const [pendingUpdates, setPendingUpdates] = useState<PendingUpdate[]>([]);
    const [isParsingAnswerSheet, setIsParsingAnswerSheet] = useState(false);
    const [isSolvingMismatches, setIsSolvingMismatches] = useState(false);
    const [isConfirmingUpdates, setIsConfirmingUpdates] = useState(false);
    const [showUpdatePreview, setShowUpdatePreview] = useState(false);

    // Check admin permission
    useEffect(() => {
        if (!isAdmin(session)) {
            navigate('dashboard');
        }
    }, [session, navigate]);

    // Load questions with server-side filtering
    const loadQuestions = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const yearValue = filterYear ? parseInt(filterYear, 10) : undefined;
            const sessionValue = filterExamSession ? parseInt(filterExamSession, 10) : undefined;
            const { questions: fetchedQuestions, count } = await quizApi.loadQuestionsPaged({
                certification: filterCertification || undefined,
                subject: filterSubject || undefined,
                topic: filterTopic || undefined,
                year: Number.isNaN(yearValue ?? NaN) ? undefined : yearValue,
                examSession: Number.isNaN(sessionValue ?? NaN) ? undefined : sessionValue,
                search: searchText || undefined,
                page: currentPage,
                pageSize: itemsPerPage
            });

            setTotalCount(count ?? null);

            const normalizedQuestions: ManagedQuestion[] = fetchedQuestions.map(question => {
                const normalizedSubject = normalizeSubjectValue(question.subject);
                const normalizedTopic = normalizeTopicValue(question.topicCategory);
                return {
                    ...question,
                    normalizedSubject,
                    normalizedTopic
                };
            });
            setQuestions(normalizedQuestions);
        } catch (err) {
            setError('문제 목록을 불러오는데 실패했습니다.');
            console.error(err);
        } finally {
            setLoading(false);
        }
    }, [filterCertification, filterSubject, filterTopic, filterYear, filterExamSession, searchText, currentPage]);

    const loadFilterOptions = useCallback(async () => {
        const batchSize = 1000;
        const years = new Set<number>();
        const sessions = new Set<number>();
        const subjects = new Set<string>();
        const certifications = new Set<string>();
        const topicsBySubject = new Map<string, Set<string>>();
        const subjectsByCert = new Map<string, Set<string>>();
        const yearsByCert = new Map<string, Set<number>>();
        const sessionsByCert = new Map<string, Set<number>>();
        const yearsByCertSubject = new Map<string, Set<number>>();
        const topicsByCertSubject = new Map<string, Set<string>>();
        let offset = 0;

        while (true) {
            const { data, error } = await supabase
                .from('questions')
                .select('year,exam_session,subject,topic_category,certification')
                .order('id', { ascending: true })
                .range(offset, offset + batchSize - 1);

            if (error) {
                console.error('Error loading filter options:', error);
                break;
            }

            const rows = data || [];
            if (rows.length === 0) break;

            rows.forEach(row => {
                const subjectValue = normalizeKey(row.subject);
                const certificationValue = normalizeKey(row.certification);
                const topicValue = normalizeKey(row.topic_category);

                if (row.year) years.add(row.year);
                if (row.exam_session) sessions.add(row.exam_session);
                if (subjectValue) {
                    subjects.add(subjectValue);
                    if (topicValue) {
                        if (!topicsBySubject.has(subjectValue)) {
                            topicsBySubject.set(subjectValue, new Set());
                        }
                        topicsBySubject.get(subjectValue)!.add(topicValue);
                    }
                }
                if (certificationValue) {
                    certifications.add(certificationValue);
                    if (subjectValue) {
                        if (!subjectsByCert.has(certificationValue)) {
                            subjectsByCert.set(certificationValue, new Set());
                        }
                        subjectsByCert.get(certificationValue)!.add(subjectValue);
                    }
                    if (row.year) {
                        if (!yearsByCert.has(certificationValue)) {
                            yearsByCert.set(certificationValue, new Set());
                        }
                        yearsByCert.get(certificationValue)!.add(row.year);
                    }
                    if (row.exam_session) {
                        if (!sessionsByCert.has(certificationValue)) {
                            sessionsByCert.set(certificationValue, new Set());
                        }
                        sessionsByCert.get(certificationValue)!.add(row.exam_session);
                    }
                    if (subjectValue && row.year) {
                        const key = `${certificationValue}::${subjectValue}`;
                        if (!yearsByCertSubject.has(key)) {
                            yearsByCertSubject.set(key, new Set());
                        }
                        yearsByCertSubject.get(key)!.add(row.year);
                    }
                    if (subjectValue && topicValue) {
                        const key = `${certificationValue}::${subjectValue}`;
                        if (!topicsByCertSubject.has(key)) {
                            topicsByCertSubject.set(key, new Set());
                        }
                        topicsByCertSubject.get(key)!.add(topicValue);
                    }
                }
            });

            if (rows.length < batchSize) break;
            offset += batchSize;
        }

        const globalSubjectOrderMap = buildSubjectOrderMap();

        setAvailableYears(Array.from(years).sort((a, b) => b - a));
        setAvailableExamSessions(Array.from(sessions).sort((a, b) => a - b));
        setAvailableSubjects(sortSubjectsByOrder(Array.from(subjects), globalSubjectOrderMap));
        setAvailableCertifications(Array.from(certifications).sort((a, b) => a.localeCompare(b)));

        const topicsRecord: Record<string, string[]> = {};
        topicsBySubject.forEach((topicSet, subject) => {
            topicsRecord[subject] = Array.from(topicSet).sort((a, b) => a.localeCompare(b));
        });
        setAvailableTopicsBySubject(topicsRecord);

        const subjectsByCertRecord: Record<string, string[]> = {};
        subjectsByCert.forEach((subjectSet, cert) => {
            const certOrderMap = buildCertificationSubjectOrderMap(cert);
            subjectsByCertRecord[cert] = sortSubjectsByOrder(Array.from(subjectSet), certOrderMap);
        });
        setSubjectsByCertification(subjectsByCertRecord);

        const yearsByCertRecord: Record<string, number[]> = {};
        yearsByCert.forEach((yearSet, cert) => {
            yearsByCertRecord[cert] = Array.from(yearSet).sort((a, b) => b - a);
        });
        setYearsByCertification(yearsByCertRecord);

        const sessionsByCertRecord: Record<string, number[]> = {};
        sessionsByCert.forEach((sessionSet, cert) => {
            sessionsByCertRecord[cert] = Array.from(sessionSet).sort((a, b) => a - b);
        });
        setSessionsByCertification(sessionsByCertRecord);

        const yearsByCertSubjectRecord: Record<string, number[]> = {};
        yearsByCertSubject.forEach((yearSet, key) => {
            yearsByCertSubjectRecord[key] = Array.from(yearSet).sort((a, b) => b - a);
        });
        setYearsByCertificationSubject(yearsByCertSubjectRecord);

        const topicsByCertSubjectRecord: Record<string, string[]> = {};
        topicsByCertSubject.forEach((topicSet, key) => {
            topicsByCertSubjectRecord[key] = Array.from(topicSet).sort((a, b) => a.localeCompare(b));
        });
        setTopicsByCertificationSubject(topicsByCertSubjectRecord);
    }, []);

    const mapAnswerCharToIndex = (value?: string): number | null => {
        const normalized = (value ?? '').trim();
        if (normalized === '가') return 0;
        if (normalized === '나') return 1;
        if (normalized === '다') return 2;
        if (normalized === '라') return 3;
        return null;
    };

    const formatAnswerIndex = (value: number): string => {
        const options = ['가', '나', '다', '라'];
        return options[value] ?? '-';
    };

    const extractQuestionNumber = (text: string): number | null => {
        const match = text.match(/^\s*(\d{1,3})\s*[.)]/);
        if (!match) return null;
        const parsed = parseInt(match[1], 10);
        return Number.isNaN(parsed) ? null : parsed;
    };

    const fetchImageAsDataUrl = async (url: string): Promise<string> => {
        const response = await fetch(url);
        const blob = await response.blob();
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    };

    const buildMismatchList = async (answers: AnswerSheetEntry[]) => {
        const yearValue = filterYear ? parseInt(filterYear, 10) : NaN;
        const sessionValue = filterExamSession ? parseInt(filterExamSession, 10) : NaN;

        if (Number.isNaN(yearValue) || Number.isNaN(sessionValue)) {
            setError('연도와 회차를 선택해주세요.');
            return;
        }

        const questionsForCompare = await quizApi.loadQuestions({
            year: yearValue,
            examSession: sessionValue,
            certification: filterCertification || undefined
        });

        const normalizedQuestions: ManagedQuestion[] = questionsForCompare.map(question => ({
            ...question,
            normalizedSubject: normalizeSubjectValue(question.subject),
            normalizedTopic: normalizeTopicValue(question.topicCategory)
        }));

        const answersByNumber = new Map<number, number>();
        answers.forEach(entry => {
            const index = mapAnswerCharToIndex(entry.answer);
            if (index !== null) {
                answersByNumber.set(entry.question_number, index);
            }
        });

        const mismatches: AnswerMismatch[] = [];
        normalizedQuestions.forEach(question => {
            const questionNumber = extractQuestionNumber(question.questionText);
            if (!questionNumber) return;
            const expectedIndex = answersByNumber.get(questionNumber);
            if (expectedIndex === undefined) return;
            if (question.answerIndex !== expectedIndex) {
                mismatches.push({
                    questionId: question.id,
                    questionNumber,
                    expectedIndex,
                    currentIndex: question.answerIndex,
                    question
                });
            }
        });

        setAnswerMismatches(mismatches);
    };

    // Initial load and reload when filters change
    useEffect(() => {
        loadQuestions();
    }, [loadQuestions]);

    useEffect(() => {
        loadFilterOptions();
    }, [loadFilterOptions]);


    // Local filtering (Search and Year)
    const displayQuestions = questions;

    // Reset page when search or server-side filters change
    useEffect(() => {
        setCurrentPage(1);
    }, [filterCertification, filterSubject, filterYear, filterExamSession, filterTopic, searchText]);

    useEffect(() => {
        setScrollTop(0);
    }, [currentPage]);

    const handleAnswerSheetUpload = async () => {
        if (!answerSheetFile) {
            setError('정답표 이미지를 선택해주세요.');
            return;
        }
        setError(null);
        setSuccessMessage(null);
        setIsParsingAnswerSheet(true);
        try {
            const parsed = await parseAnswerSheetFromImage(answerSheetFile);
            setAnswerSheetAnswers(parsed);
            await buildMismatchList(parsed);
            setSuccessMessage(`정답표 인식 완료: ${parsed.length}개 항목`);
        } catch (err) {
            console.error(err);
            setError('정답표 인식에 실패했습니다.');
        } finally {
            setIsParsingAnswerSheet(false);
        }
    };

    const handleSolveMismatches = async () => {
        if (answerMismatches.length === 0) {
            setError('불일치 문제가 없습니다.');
            return;
        }
        setError(null);
        setIsSolvingMismatches(true);
        const updates: PendingUpdate[] = [];
        for (const mismatch of answerMismatches) {
            const { question } = mismatch;
            try {
                let solved;
                if (question.diagramUrl) {
                    const dataUrl = await fetchImageAsDataUrl(question.diagramUrl);
                    solved = await generateExplanationForAnswer(question, mismatch.expectedIndex, dataUrl);
                } else {
                    solved = await generateExplanationForAnswer(question, mismatch.expectedIndex);
                }
                updates.push({
                    questionId: mismatch.questionId,
                    questionNumber: mismatch.questionNumber,
                    expectedIndex: mismatch.expectedIndex,
                    currentIndex: mismatch.currentIndex,
                    newIndex: mismatch.expectedIndex,
                    aiExplanation: preferNonEmptyText(solved.aiExplanation, question.aiExplanation),
                    hint: preferNonEmptyText(solved.hint, question.hint),
                    rationale: preferNonEmptyText(solved.rationale, question.rationale),
                    diagram_info: solved.diagram_info ?? question.diagram_info
                });
            } catch (solveError) {
                console.error('Re-solve failed:', solveError);
            }
        }
        setPendingUpdates(updates);
        setShowUpdatePreview(true);
        setIsSolvingMismatches(false);
    };

    const applyPendingUpdates = async () => {
        if (pendingUpdates.length === 0) {
            setShowUpdatePreview(false);
            return;
        }
        setIsConfirmingUpdates(true);
        try {
            for (const update of pendingUpdates) {
                await quizApi.updateQuestion(update.questionId, {
                    answerIndex: update.newIndex,
                    aiExplanation: update.aiExplanation,
                    hint: update.hint,
                    rationale: update.rationale,
                    diagram_info: update.diagram_info
                });
            }
            setSuccessMessage(`정답 수정 완료: ${pendingUpdates.length}건`);
            setPendingUpdates([]);
            setShowUpdatePreview(false);
            await loadQuestions();
        } catch (err) {
            console.error(err);
            setError('정답 업데이트에 실패했습니다.');
        } finally {
            setIsConfirmingUpdates(false);
        }
    };


    // Get unique years
    const availableSubjectsForFilter = useMemo(() => {
        if (!filterCertification) return availableSubjects;

        const fromData = subjectsByCertification[filterCertification] || [];
        const fromConstants = (CERTIFICATION_SUBJECTS[filterCertification as keyof typeof CERTIFICATION_SUBJECTS] || [])
            .map(subject => normalizeKey(subject))
            .filter(Boolean);
        const merged = Array.from(new Set([...fromData, ...fromConstants]));
        const certOrderMap = buildCertificationSubjectOrderMap(filterCertification);

        return sortSubjectsByOrder(merged, certOrderMap);
    }, [availableSubjects, filterCertification, subjectsByCertification]);

    const availableYearsForFilter = useMemo(() => {
        if (filterCertification && filterSubject) {
            const key = `${filterCertification}::${filterSubject}`;
            return yearsByCertificationSubject[key] || [];
        }
        if (filterCertification) {
            return yearsByCertification[filterCertification] || [];
        }
        return availableYears;
    }, [availableYears, filterCertification, filterSubject, yearsByCertification, yearsByCertificationSubject]);

    const availableSessionsForFilter = useMemo(() => {
        if (filterCertification) {
            return sessionsByCertification[filterCertification] || [];
        }
        return availableExamSessions;
    }, [availableExamSessions, filterCertification, sessionsByCertification]);

    const availableTopics = useMemo(() => {
        if (!filterSubject) return [];
        if (filterCertification) {
            const key = `${filterCertification}::${filterSubject}`;
            return topicsByCertificationSubject[key] || [];
        }
        return availableTopicsBySubject[filterSubject] || [];
    }, [availableTopicsBySubject, filterCertification, filterSubject, topicsByCertificationSubject]);

    const uniqueYears = availableYearsForFilter;

    // Pagination
    const totalPages = Math.max(1, Math.ceil((totalCount ?? 0) / itemsPerPage));
    const startIndex = (currentPage - 1) * itemsPerPage;
    const paginatedQuestions = displayQuestions;

    const shouldVirtualize = !editingId && !deleteConfirmId;
    const totalRows = paginatedQuestions.length;
    const visibleCount = Math.ceil(listHeight / rowHeight) + 4;
    const startRow = Math.max(0, Math.floor(scrollTop / rowHeight) - 2);
    const endRow = Math.min(totalRows, startRow + visibleCount);
    const offsetY = startRow * rowHeight;

    // Handle edit
    const startEdit = (question: ManagedQuestion) => {
        // Verify the question exists in the current list
        const exists = questions.find(q => q.id === question.id);
        if (!exists) {
            setError(`문제 ID ${question.id}를 찾을 수 없습니다. 목록을 새로고침해주세요.`);
            return;
        }

        setEditingId(question.id);
        setEditForm({
            subject: question.normalizedSubject === '기타' ? '' : question.normalizedSubject,
            certification: question.certification,
            year: question.year,
            examSession: question.examSession,
            topicCategory: question.normalizedTopic === '기타' ? '' : question.normalizedTopic
        });
    };

    const cancelEdit = () => {
        setEditingId(null);
        setEditForm({});
    };

    const saveEdit = async (id: number) => {
        try {
            setError(null);
            setSuccessMessage(null);

            console.log('=== Saving Edit ===');
            console.log('Question ID:', id);
            console.log('Edit form data:', editForm);

            const result = await quizApi.updateQuestion(id, editForm);

            console.log('Update result:', result);

            setSuccessMessage(`문제 ID ${id}가 성공적으로 수정되었습니다.`);
            setTimeout(() => setSuccessMessage(null), 5000);

            setEditingId(null);
            setEditForm({});

            // Force reload questions to ensure fresh data
            console.log('Reloading questions...');
            await loadQuestions();
            await loadFilterOptions();
            console.log('Questions reloaded');
        } catch (err: any) {
            const errorMessage = err?.message || '문제 수정에 실패했습니다.';
            setError(errorMessage);
            console.error('Save edit error:', err);
            console.error('Edit form data:', editForm);
            console.error('Question ID:', id);
        }
    };

    // Handle delete
    const confirmDelete = (id: number) => {
        setDeleteConfirmId(id);
    };

    const cancelDelete = () => {
        setDeleteConfirmId(null);
        setDeleteWithStorage(true);
    };

    const executeDelete = async (id: number) => {
        try {
            setError(null);
            if (deleteWithStorage) {
                await quizApi.deleteQuestionWithStorage(id);
                setSuccessMessage('문제와 관련 파일이 삭제되었습니다.');
            } else {
                await quizApi.deleteQuestion(id);
                setSuccessMessage('문제가 삭제되었습니다.');
            }
            setTimeout(() => setSuccessMessage(null), 3000);
            setDeleteConfirmId(null);
            setDeleteWithStorage(true);
            await loadQuestions();
            await loadFilterOptions();
        } catch (err) {
            setError('문제 삭제에 실패했습니다.');
            console.error(err);
        }
    };

    const certificationOptions = availableCertifications.length > 0 ? availableCertifications : CERTIFICATIONS;

    if (loading) {
        return <div className="text-center p-8">로딩 중...</div>;
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-200">문제 관리</h2>
                <div className="flex gap-2">
                    <button
                        onClick={loadQuestions}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg flex items-center gap-2"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        새로고침
                    </button>
                    <button
                        onClick={() => navigate('dashboard')}
                        className="bg-slate-600 hover:bg-slate-700 text-white px-4 py-2 rounded-lg"
                    >
                        대시보드로 돌아가기
                    </button>
                </div>
            </div>

            {/* Messages */}
            {error && (
                <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
                    {error}
                </div>
            )}
            {successMessage && (
                <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded">
                    {successMessage}
                </div>
            )}

            {/* Filters */}
            <div className="bg-slate-100 dark:bg-slate-700 p-4 rounded-lg space-y-4">
                <h3 className="font-semibold text-slate-800 dark:text-slate-200">필터</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                            자격증
                        </label>
                        <select
                            value={filterCertification}
                            onChange={(e) => {
                                setFilterCertification(e.target.value);
                                setFilterSubject(''); // Reset subject when certification changes
                                setFilterExamSession('');
                                setFilterTopic(''); // Reset topic when certification changes
                            }}
                            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                        >
                            <option value="">전체</option>
                            {certificationOptions.map(cert => (
                                <option key={cert} value={cert}>{cert}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                            과목
                        </label>
                        <select
                            value={filterSubject}
                            onChange={(e) => {
                                setFilterSubject(e.target.value);
                                setFilterTopic(''); // Reset topic when subject changes
                            }}
                            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                        >
                            <option value="">전체</option>
                            {availableSubjectsForFilter.map(subject => (
                                <option key={subject} value={subject}>{subject}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                            연도
                        </label>
                        <select
                            value={filterYear}
                            onChange={(e) => setFilterYear(e.target.value)}
                            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                        >
                            <option value="">전체</option>
                            {uniqueYears.map(year => (
                                <option key={year} value={year}>{year}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                            회차
                        </label>
                        <select
                            value={filterExamSession}
                            onChange={(e) => setFilterExamSession(e.target.value)}
                            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                        >
                            <option value="">전체</option>
                            {availableSessionsForFilter.map(session => (
                                <option key={session} value={session}>{session}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                            주제
                        </label>
                        <select
                            value={filterTopic}
                            onChange={(e) => setFilterTopic(e.target.value)}
                            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                            disabled={!filterSubject}
                        >
                            <option value="">전체</option>
                            {availableTopics.map(topic => (
                                <option key={topic} value={topic}>{topic}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                            검색
                        </label>
                        <input
                            type="text"
                            value={searchText}
                            onChange={(e) => setSearchText(e.target.value)}
                            placeholder="문제 내용 또는 ID"
                            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                        />
                    </div>
                </div>

                <div className="flex justify-between items-center">
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                        총 {totalCount ?? displayQuestions.length}개의 문제
                    </p>
                    <button
                        onClick={() => {
                            setFilterSubject('');
                            setFilterCertification('');
                            setFilterYear('');
                            setFilterExamSession('');
                            setFilterTopic('');
                            setSearchText('');
                        }}
                        className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400"
                    >
                        필터 초기화
                    </button>
                </div>
            </div>

            {/* Answer Sheet Comparison */}
            <div className="bg-white dark:bg-slate-800 p-6 rounded-lg shadow space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200">정답표 비교</h3>
                        <p className="text-sm text-slate-500 dark:text-slate-400">연도/회차 필터를 선택한 뒤 정답표 이미지를 업로드하세요.</p>
                    </div>
                    <button
                        onClick={handleAnswerSheetUpload}
                        disabled={isParsingAnswerSheet || !answerSheetFile}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg disabled:opacity-50"
                    >
                        {isParsingAnswerSheet ? '인식 중...' : '정답표 분석'}
                    </button>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => setAnswerSheetFile(e.target.files?.[0] || null)}
                        className="text-sm text-slate-700 dark:text-slate-200"
                    />
                    {answerSheetAnswers.length > 0 && (
                        <span className="text-sm text-slate-600 dark:text-slate-300">
                            인식된 정답: {answerSheetAnswers.length}개
                        </span>
                    )}
                </div>
                <div className="flex flex-wrap items-center gap-4">
                    <span className="text-sm text-slate-600 dark:text-slate-300">
                        불일치: {answerMismatches.length}건
                    </span>
                    <button
                        onClick={handleSolveMismatches}
                        disabled={answerMismatches.length === 0 || isSolvingMismatches}
                        className="bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-lg disabled:opacity-50"
                    >
                        {isSolvingMismatches ? '재풀이 중...' : '불일치 재풀이'}
                    </button>
                </div>
                {answerMismatches.length > 0 && (
                    <div className="overflow-x-auto border border-slate-200 dark:border-slate-700 rounded-lg">
                        <table className="w-full text-sm">
                            <thead className="bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                                <tr>
                                    <th className="px-3 py-2 text-left">문항</th>
                                    <th className="px-3 py-2 text-left">기존</th>
                                    <th className="px-3 py-2 text-left">정답표</th>
                                    <th className="px-3 py-2 text-left">문제</th>
                                </tr>
                            </thead>
                            <tbody>
                                {answerMismatches.slice(0, 8).map(mismatch => (
                                    <tr key={mismatch.questionId} className="border-t border-slate-200 dark:border-slate-700">
                                        <td className="px-3 py-2">{mismatch.questionNumber}</td>
                                        <td className="px-3 py-2">{formatAnswerIndex(mismatch.currentIndex)}</td>
                                        <td className="px-3 py-2 font-semibold text-red-600">{formatAnswerIndex(mismatch.expectedIndex)}</td>
                                        <td className="px-3 py-2 truncate max-w-xs">{mismatch.question.questionText.substring(0, 40)}...</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Question Table */}
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead className="bg-slate-200 dark:bg-slate-700">
                            <tr>
                                <th className="px-4 py-3 text-left text-xs font-medium text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                                    ID
                                </th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                                    자격증
                                </th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                                    과목
                                </th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                                    연도
                                </th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                                    회차
                                </th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                                    주제
                                </th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                                    문제
                                </th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                                    작업
                                </th>
                            </tr>
                        </thead>
                        {!shouldVirtualize && (
                            <tbody className="divide-y divide-slate-200 dark:divide-slate-600">
                                {paginatedQuestions.map((question) => (
                                    <tr key={question.id} className="hover:bg-slate-50 dark:hover:bg-slate-700">
                                        <td className="px-4 py-3 text-sm text-slate-900 dark:text-slate-100">
                                            {question.id}
                                        </td>
                                        <td className="px-4 py-3 text-sm text-slate-900 dark:text-slate-100">
                                            {editingId === question.id ? (
                                                <select
                                                    value={editForm.certification || ''}
                                                    onChange={(e) => setEditForm({ ...editForm, certification: e.target.value, subject: '' })}
                                                    className="w-full px-2 py-1 border rounded bg-white dark:bg-slate-700"
                                                >
                                                    {CERTIFICATIONS.map(cert => (
                                                        <option key={cert} value={cert}>{cert}</option>
                                                    ))}
                                                </select>
                                            ) : (
                                                question.certification || '-'
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-sm text-slate-900 dark:text-slate-100">
                                            {editingId === question.id ? (
                                                <input
                                                    type="text"
                                                    value={editForm.subject || ''}
                                                    onChange={(e) => setEditForm({ ...editForm, subject: e.target.value })}
                                                    className="w-full px-2 py-1 border rounded bg-white dark:bg-slate-700"
                                                    placeholder="과목 입력"
                                                />
                                            ) : (
                                                question.normalizedSubject === '기타' && question.subject
                                                    ? `기타 (${question.subject})`
                                                    : question.normalizedSubject
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-sm text-slate-900 dark:text-slate-100">
                                            {editingId === question.id ? (
                                                <input
                                                    type="number"
                                                    value={editForm.year || ''}
                                                    onChange={(e) => setEditForm({ ...editForm, year: parseInt(e.target.value) })}
                                                    className="w-20 px-2 py-1 border rounded bg-white dark:bg-slate-700"
                                                />
                                            ) : (
                                                question.year
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-sm text-slate-900 dark:text-slate-100">
                                            {editingId === question.id ? (
                                                <input
                                                    type="number"
                                                    value={editForm.examSession ?? ''}
                                                    onChange={(e) => setEditForm({ ...editForm, examSession: parseInt(e.target.value) })}
                                                    className="w-16 px-2 py-1 border rounded bg-white dark:bg-slate-700"
                                                />
                                            ) : (
                                                question.examSession ?? '-'
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-sm text-slate-900 dark:text-slate-100">
                                            {editingId === question.id ? (() => {
                                                // Get available topics based on certification and subject
                                                const currentSubject = editForm.subject || question.normalizedSubject;
                                                const availableTopicsForEdit = SUBJECT_TOPICS[currentSubject] || [];

                                                return (
                                                    <select
                                                        value={editForm.topicCategory || ''}
                                                        onChange={(e) => setEditForm({ ...editForm, topicCategory: e.target.value })}
                                                        className="w-full px-2 py-1 border rounded bg-white dark:bg-slate-700"
                                                    >
                                                        <option value="">주제 선택</option>
                                                        {availableTopicsForEdit.map(topic => (
                                                            <option key={topic} value={topic}>{topic}</option>
                                                        ))}
                                                    </select>
                                                );
                                            })() : (
                                                question.normalizedTopic === '기타' && question.topicCategory
                                                    ? `기타 (${question.topicCategory})`
                                                    : question.normalizedTopic
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-sm text-slate-900 dark:text-slate-100 max-w-xs">
                                            <button
                                                onClick={() => setSelectedQuestion(question)}
                                                className="text-left hover:text-blue-600 dark:hover:text-blue-400 underline decoration-dotted truncate block w-full"
                                                title="클릭하여 전체 내용 보기"
                                            >
                                                {question.questionText.substring(0, 50)}...
                                            </button>
                                        </td>
                                        <td className="px-4 py-3 text-sm">
                                            {editingId === question.id ? (
                                                <div className="flex gap-2">
                                                    <button
                                                        onClick={() => saveEdit(question.id)}
                                                        className="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded text-xs"
                                                    >
                                                        저장
                                                    </button>
                                                    <button
                                                        onClick={cancelEdit}
                                                        className="bg-slate-600 hover:bg-slate-700 text-white px-3 py-1 rounded text-xs"
                                                    >
                                                        취소
                                                    </button>
                                                </div>
                                            ) : deleteConfirmId === question.id ? (
                                                <div className="space-y-2">
                                                    <p className="text-xs text-red-600 dark:text-red-400 font-semibold">삭제하시겠습니까?</p>
                                                    <div className="flex items-center gap-2 mb-2">
                                                        <input
                                                            type="checkbox"
                                                            id={`delete-storage-${question.id}`}
                                                            checked={deleteWithStorage}
                                                            onChange={(e) => setDeleteWithStorage(e.target.checked)}
                                                            className="rounded"
                                                        />
                                                        <label htmlFor={`delete-storage-${question.id}`} className="text-xs text-slate-700 dark:text-slate-300">
                                                            파일도 삭제
                                                        </label>
                                                    </div>
                                                    <div className="flex gap-2">
                                                        <button
                                                            onClick={() => executeDelete(question.id)}
                                                            className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded text-xs"
                                                        >
                                                            확인
                                                        </button>
                                                        <button
                                                            onClick={cancelDelete}
                                                            className="bg-slate-600 hover:bg-slate-700 text-white px-3 py-1 rounded text-xs"
                                                        >
                                                            취소
                                                        </button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="flex gap-2">
                                                    <button
                                                        onClick={() => startEdit(question)}
                                                        className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-xs"
                                                    >
                                                        수정
                                                    </button>
                                                    <button
                                                        onClick={() => confirmDelete(question.id)}
                                                        className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded text-xs"
                                                    >
                                                        삭제
                                                    </button>
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        )}
                    </table>
                    {shouldVirtualize && (
                        <div
                            className="border-t border-slate-200 dark:border-slate-600 overflow-y-auto"
                            style={{ height: listHeight }}
                            onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
                        >
                            <div style={{ height: totalRows * rowHeight, position: 'relative' }}>
                                <div style={{ transform: `translateY(${offsetY}px)` }}>
                                    {paginatedQuestions.slice(startRow, endRow).map((question) => (
                                        <div
                                            key={question.id}
                                            className="grid grid-cols-[80px_160px_160px_80px_70px_160px_1fr_140px] border-b border-slate-200 dark:border-slate-600 text-sm text-slate-900 dark:text-slate-100"
                                            style={{ height: rowHeight }}
                                        >
                                            <div className="px-4 py-3">{question.id}</div>
                                            <div className="px-4 py-3">{question.certification || '-'}</div>
                                            <div className="px-4 py-3">
                                                {question.normalizedSubject === '기타' && question.subject
                                                    ? `기타 (${question.subject})`
                                                    : question.normalizedSubject}
                                            </div>
                                            <div className="px-4 py-3">{question.year}</div>
                                            <div className="px-4 py-3">{question.examSession ?? '-'}</div>
                                            <div className="px-4 py-3">
                                                {question.normalizedTopic === '기타' && question.topicCategory
                                                    ? `기타 (${question.topicCategory})`
                                                    : question.normalizedTopic}
                                            </div>
                                            <div className="px-4 py-3 max-w-xs">
                                                <button
                                                    onClick={() => setSelectedQuestion(question)}
                                                    className="text-left hover:text-blue-600 dark:hover:text-blue-400 underline decoration-dotted truncate block w-full"
                                                    title="클릭하여 전체 내용 보기"
                                                >
                                                    {question.questionText.substring(0, 50)}...
                                                </button>
                                            </div>
                                            <div className="px-4 py-3">
                                                <div className="flex gap-2">
                                                    <button
                                                        onClick={() => startEdit(question)}
                                                        className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-xs"
                                                    >
                                                        수정
                                                    </button>
                                                    <button
                                                        onClick={() => confirmDelete(question.id)}
                                                        className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded text-xs"
                                                    >
                                                        삭제
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                    <div className="bg-slate-100 dark:bg-slate-700 px-4 py-3 flex items-center justify-between border-t border-slate-200 dark:border-slate-600">
                        <div className="flex-1 flex justify-between sm:hidden">
                            <button
                                onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                                disabled={currentPage === 1}
                                className="relative inline-flex items-center px-4 py-2 border border-slate-300 text-sm font-medium rounded-md text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-50"
                            >
                                이전
                            </button>
                            <button
                                onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                                disabled={currentPage === totalPages}
                                className="ml-3 relative inline-flex items-center px-4 py-2 border border-slate-300 text-sm font-medium rounded-md text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-50"
                            >
                                다음
                            </button>
                        </div>
                        <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
                            <div>
                                <p className="text-sm text-slate-700 dark:text-slate-300">
                                    <span className="font-medium">{startIndex + 1}</span> - <span className="font-medium">{Math.min(startIndex + itemsPerPage, displayQuestions.length)}</span> / <span className="font-medium">{totalCount ?? displayQuestions.length}</span>
                                </p>
                            </div>
                            <div>
                                <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px">
                                    <button
                                        onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                                        disabled={currentPage === 1}
                                        className="relative inline-flex items-center px-2 py-2 rounded-l-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50"
                                    >
                                        이전
                                    </button>
                                    {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                                        let pageNum;
                                        if (totalPages <= 5) {
                                            pageNum = i + 1;
                                        } else if (currentPage <= 3) {
                                            pageNum = i + 1;
                                        } else if (currentPage >= totalPages - 2) {
                                            pageNum = totalPages - 4 + i;
                                        } else {
                                            pageNum = currentPage - 2 + i;
                                        }
                                        return (
                                            <button
                                                key={pageNum}
                                                onClick={() => setCurrentPage(pageNum)}
                                                className={`relative inline-flex items-center px-4 py-2 border text-sm font-medium ${currentPage === pageNum
                                                    ? 'z-10 bg-blue-50 dark:bg-blue-900 border-blue-500 text-blue-600 dark:text-blue-300'
                                                    : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'
                                                    }`}
                                            >
                                                {pageNum}
                                            </button>
                                        );
                                    })}
                                    <button
                                        onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                                        disabled={currentPage === totalPages}
                                        className="relative inline-flex items-center px-2 py-2 rounded-r-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50"
                                    >
                                        다음
                                    </button>
                                </nav>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Question Detail Modal */}
            {showUpdatePreview && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4 py-6">
                    <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden border border-slate-200 dark:border-slate-700 flex flex-col">
                        <header className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
                            <div>
                                <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">정답 변경 미리보기</h3>
                                <p className="text-sm text-slate-500 dark:text-slate-400">
                                    변경 예정: {pendingUpdates.length}건
                                </p>
                            </div>
                            <button
                                onClick={() => setShowUpdatePreview(false)}
                                className="text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                            >
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </header>
                        <div className="p-6 overflow-y-auto">
                            <table className="w-full text-sm border border-slate-200 dark:border-slate-700">
                                <thead className="bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                                    <tr>
                                        <th className="px-3 py-2 text-left">문항</th>
                                        <th className="px-3 py-2 text-left">기존</th>
                                        <th className="px-3 py-2 text-left">정답표</th>
                                        <th className="px-3 py-2 text-left">재풀이</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {pendingUpdates.map(update => (
                                        <tr key={update.questionId} className="border-t border-slate-200 dark:border-slate-700">
                                            <td className="px-3 py-2">{update.questionNumber}</td>
                                            <td className="px-3 py-2">{formatAnswerIndex(update.currentIndex)}</td>
                                            <td className="px-3 py-2 text-red-600">{formatAnswerIndex(update.expectedIndex)}</td>
                                            <td className="px-3 py-2 text-green-600 font-semibold">{formatAnswerIndex(update.newIndex)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <footer className="px-6 py-4 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-3">
                            <button
                                onClick={() => setShowUpdatePreview(false)}
                                className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300"
                                disabled={isConfirmingUpdates}
                            >
                                취소
                            </button>
                            <button
                                onClick={applyPendingUpdates}
                                className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50"
                                disabled={isConfirmingUpdates}
                            >
                                {isConfirmingUpdates ? '저장 중...' : '저장'}
                            </button>
                        </footer>
                    </div>
                </div>
            )}

            {selectedQuestion && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
                        <div className="p-6">
                            <div className="flex justify-between items-start mb-4">
                                <h3 className="text-xl font-bold text-slate-800 dark:text-slate-200">
                                    문제 상세 정보
                                </h3>
                                <button
                                    onClick={() => setSelectedQuestion(null)}
                                    className="text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                                >
                                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>

                            <div className="space-y-4">
                                {/* Metadata */}
                                <div className="grid grid-cols-2 md:grid-cols-5 gap-3 p-4 bg-slate-100 dark:bg-slate-700 rounded-lg">
                                    <div>
                                        <p className="text-xs text-slate-600 dark:text-slate-400">ID</p>
                                        <p className="font-semibold text-slate-900 dark:text-slate-100">{selectedQuestion.id}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-slate-600 dark:text-slate-400">자격증</p>
                                        <p className="font-semibold text-slate-900 dark:text-slate-100">{selectedQuestion.certification}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-slate-600 dark:text-slate-400">과목</p>
                                        <p className="font-semibold text-slate-900 dark:text-slate-100">{selectedQuestion.normalizedSubject}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-slate-600 dark:text-slate-400">연도</p>
                                        <p className="font-semibold text-slate-900 dark:text-slate-100">{selectedQuestion.year}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-slate-600 dark:text-slate-400">회차</p>
                                        <p className="font-semibold text-slate-900 dark:text-slate-100">{selectedQuestion.examSession ?? '-'}</p>
                                    </div>
                                </div>

                                {/* Question Text */}
                                <div>
                                    <h4 className="font-semibold text-slate-700 dark:text-slate-300 mb-2">문제</h4>
                                    <div className="text-slate-900 dark:text-slate-100 whitespace-pre-wrap">
                                        <FormattedText text={selectedQuestion.questionText} />
                                    </div>
                                </div>

                                {/* Options */}
                                {selectedQuestion.options && selectedQuestion.options.length > 0 && (
                                    <div>
                                        <h4 className="font-semibold text-slate-700 dark:text-slate-300 mb-2">선택지</h4>
                                        <div className="space-y-2">
                                            {selectedQuestion.options.map((option, idx) => (
                                                <div
                                                    key={idx}
                                                    className={`p-3 rounded-lg border ${idx === selectedQuestion.answerIndex
                                                        ? 'border-green-500 bg-green-50 dark:bg-green-900/30'
                                                        : 'border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700'
                                                        }`}
                                                >
                                                    <span className="font-semibold mr-2">{idx + 1}.</span>
                                                    <FormattedText text={option} />
                                                    {idx === selectedQuestion.answerIndex && (
                                                        <span className="ml-2 text-xs font-semibold text-green-600 dark:text-green-300">
                                                            (정답)
                                                        </span>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Explanation */}
                                {selectedQuestion.explanation && (
                                    <div>
                                        <h4 className="font-semibold text-slate-700 dark:text-slate-300 mb-2">해설</h4>
                                        <p className="text-slate-900 dark:text-slate-100 whitespace-pre-wrap bg-slate-50 dark:bg-slate-700 p-4 rounded-lg">
                                            {selectedQuestion.explanation}
                                        </p>
                                    </div>
                                )}
                            </div>

                            <div className="mt-6 flex justify-end">
                                <button
                                    onClick={() => setSelectedQuestion(null)}
                                    className="px-4 py-2 bg-slate-600 hover:bg-slate-700 text-white rounded-lg"
                                >
                                    닫기
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AdminQuestionManagementScreen;
