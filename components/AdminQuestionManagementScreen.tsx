import React, { useState, useEffect, useCallback } from 'react';
import { QuestionModel, AuthSession } from '../types';
import { quizApi } from '../services/quizApi';
import { isAdmin } from '../services/authService';
import { CERTIFICATIONS, CERTIFICATION_SUBJECTS, SUBJECT_TOPICS } from '../constants';

interface AdminQuestionManagementScreenProps {
    session: AuthSession;
    navigate: (screen: any) => void;
}

const AdminQuestionManagementScreen: React.FC<AdminQuestionManagementScreenProps> = ({ session, navigate }) => {
    const [questions, setQuestions] = useState<QuestionModel[]>([]);
    const [filteredQuestions, setFilteredQuestions] = useState<QuestionModel[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);

    // Filters
    const [filterSubject, setFilterSubject] = useState<string>('');
    const [filterCertification, setFilterCertification] = useState<string>('');
    const [filterYear, setFilterYear] = useState<string>('');
    const [filterTopic, setFilterTopic] = useState<string>('');
    const [searchText, setSearchText] = useState('');

    // Pagination
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 20;

    // Edit mode
    const [editingId, setEditingId] = useState<number | null>(null);
    const [editForm, setEditForm] = useState<Partial<QuestionModel>>({});

    // Delete confirmation
    const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
    const [deleteWithStorage, setDeleteWithStorage] = useState(true);

    // Check admin permission
    useEffect(() => {
        if (!isAdmin(session)) {
            navigate('dashboard');
        }
    }, [session, navigate]);

    // Load all questions
    const loadQuestions = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const allQuestions = await quizApi.getAllQuestions();
            setQuestions(allQuestions);
            setFilteredQuestions(allQuestions);
        } catch (err) {
            setError('문제 목록을 불러오는데 실패했습니다.');
            console.error(err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadQuestions();
    }, [loadQuestions]);

    // Apply filters
    useEffect(() => {
        let filtered = [...questions];

        if (filterSubject) {
            filtered = filtered.filter(q => q.subject === filterSubject);
        }
        if (filterCertification) {
            filtered = filtered.filter(q => q.certification === filterCertification);
        }
        if (filterYear) {
            const yearNum = parseInt(filterYear, 10);
            filtered = filtered.filter(q => q.year === yearNum);
        }
        if (filterTopic) {
            filtered = filtered.filter(q => q.topicCategory === filterTopic);
        }
        if (searchText) {
            const search = searchText.toLowerCase();
            filtered = filtered.filter(q =>
                q.questionText.toLowerCase().includes(search) ||
                q.id.toString().includes(search)
            );
        }

        setFilteredQuestions(filtered);
        setCurrentPage(1); // Reset to first page when filters change
    }, [questions, filterSubject, filterCertification, filterYear, filterTopic, searchText]);

    // Get unique years
    const uniqueYears = Array.from(new Set(questions.map(q => q.year))).sort((a, b) => b - a);

    // Get available topics based on selected subject
    const availableTopics = filterSubject && SUBJECT_TOPICS[filterSubject]
        ? SUBJECT_TOPICS[filterSubject]
        : [];

    // Pagination
    const totalPages = Math.ceil(filteredQuestions.length / itemsPerPage);
    const startIndex = (currentPage - 1) * itemsPerPage;
    const paginatedQuestions = filteredQuestions.slice(startIndex, startIndex + itemsPerPage);

    // Handle edit
    const startEdit = (question: QuestionModel) => {
        // Verify the question exists in the current list
        const exists = questions.find(q => q.id === question.id);
        if (!exists) {
            setError(`문제 ID ${question.id}를 찾을 수 없습니다. 목록을 새로고침해주세요.`);
            return;
        }

        setEditingId(question.id);
        setEditForm({
            subject: question.subject,
            certification: question.certification,
            year: question.year,
            topicCategory: question.topicCategory
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
        } catch (err) {
            setError('문제 삭제에 실패했습니다.');
            console.error(err);
        }
    };

    // Get available subjects based on selected certification
    const availableSubjects = filterCertification && CERTIFICATION_SUBJECTS[filterCertification as keyof typeof CERTIFICATION_SUBJECTS]
        ? CERTIFICATION_SUBJECTS[filterCertification as keyof typeof CERTIFICATION_SUBJECTS]
        : Object.keys(SUBJECT_TOPICS);

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
                <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                            자격증
                        </label>
                        <select
                            value={filterCertification}
                            onChange={(e) => {
                                setFilterCertification(e.target.value);
                                setFilterSubject(''); // Reset subject when certification changes
                                setFilterTopic(''); // Reset topic when certification changes
                            }}
                            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                        >
                            <option value="">전체</option>
                            {CERTIFICATIONS.map(cert => (
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
                            {availableSubjects.map(subject => (
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
                        총 {filteredQuestions.length}개의 문제
                    </p>
                    <button
                        onClick={() => {
                            setFilterSubject('');
                            setFilterCertification('');
                            setFilterYear('');
                            setFilterTopic('');
                            setSearchText('');
                        }}
                        className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400"
                    >
                        필터 초기화
                    </button>
                </div>
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
                                            <select
                                                value={editForm.subject || ''}
                                                onChange={(e) => setEditForm({ ...editForm, subject: e.target.value, topicCategory: '' })}
                                                className="w-full px-2 py-1 border rounded bg-white dark:bg-slate-700"
                                            >
                                                {(editForm.certification && CERTIFICATION_SUBJECTS[editForm.certification as keyof typeof CERTIFICATION_SUBJECTS]
                                                    ? CERTIFICATION_SUBJECTS[editForm.certification as keyof typeof CERTIFICATION_SUBJECTS]
                                                    : Object.keys(SUBJECT_TOPICS)
                                                ).map(subject => (
                                                    <option key={subject} value={subject}>{subject}</option>
                                                ))}
                                            </select>
                                        ) : (
                                            question.subject
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
                                            <select
                                                value={editForm.topicCategory || ''}
                                                onChange={(e) => setEditForm({ ...editForm, topicCategory: e.target.value })}
                                                className="w-full px-2 py-1 border rounded bg-white dark:bg-slate-700"
                                                disabled={!editForm.subject}
                                            >
                                                <option value="">선택</option>
                                                {editForm.subject && SUBJECT_TOPICS[editForm.subject]?.map(topic => (
                                                    <option key={topic} value={topic}>{topic}</option>
                                                ))}
                                            </select>
                                        ) : (
                                            question.topicCategory || '-'
                                        )}
                                    </td>
                                    <td className="px-4 py-3 text-sm text-slate-900 dark:text-slate-100 max-w-xs truncate">
                                        {question.questionText.substring(0, 50)}...
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
                    </table>
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
                                    <span className="font-medium">{startIndex + 1}</span> - <span className="font-medium">{Math.min(startIndex + itemsPerPage, filteredQuestions.length)}</span> / <span className="font-medium">{filteredQuestions.length}</span>
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
        </div>
    );
};

export default AdminQuestionManagementScreen;
