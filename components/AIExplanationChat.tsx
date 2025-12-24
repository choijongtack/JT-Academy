import React, { useEffect, useRef, useState } from 'react';
import { QuestionModel } from '../types';
import FormattedText from './FormattedText';
import { sendExplanationFollowUpMessage, ExplanationChatMessage } from '../services/geminiService';

interface AIExplanationChatProps {
  question: QuestionModel;
  isOpen: boolean;
  onClose: () => void;
}

const INITIAL_PROMPT = '이 문제에 대해서 해설을 하고 이와 유사한 문제에서 꼭 암기할 사항을 보여 줘.';

type ParsedSection = {
  title: string;
  lines: string[];
};

const parseAssistantMessage = (text: string): ParsedSection[] | null => {
  if (!text) return null;
  const lines = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return null;
  }

  const sections: ParsedSection[] = [];
  let current: ParsedSection | null = null;

  lines.forEach(line => {
    const sectionMatch = line.match(/^\[(.+?)\]/);
    if (sectionMatch) {
      if (current && current.lines.length > 0) {
        sections.push(current);
      }
      current = {
        title: sectionMatch[1].trim(),
        lines: [],
      };
      const remainder = line.replace(/^\[(.+?)\]/, '').trim();
      if (remainder) {
        current.lines.push(remainder);
      }
    } else if (current) {
      current.lines.push(line);
    }
  });

  if (current && current.lines.length > 0) {
    sections.push(current);
  }

  return sections.length > 0 ? sections : null;
};

const shouldRequestContinuation = (text: string): boolean => {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/[.!?…)"'\]]$/.test(trimmed)) return false;
  if (/[,:;(\-–—]$/.test(trimmed)) return true;
  if (/(은|는|이|가|을|를|에|와|과|로|도|만|에서|까지|부터|보다|처럼|만큼|에게|께|한테|랑|이나|든)$/.test(trimmed)) {
    return true;
  }
  return false;
};

const renderAssistantContent = (content: string) => {
  const sections = parseAssistantMessage(content);
  if (!sections) {
    return <FormattedText text={content} />;
  }

  return (
    <div className="space-y-4 w-full">
      {sections.map((section, index) => {
        const bulletLines = section.lines.filter(line => /^[-•]/.test(line));
        const orderedLines = section.lines.filter(line => /^\d+\./.test(line));
        const paragraphLines = section.lines.filter(
          line => !/^[-•]/.test(line) && !/^\d+\./.test(line)
        );

        return (
          <div
            key={`${section.title}-${index}`}
            className="rounded-2xl bg-white/80 p-4 text-slate-800 shadow-sm ring-1 ring-slate-200 dark:bg-slate-800/60 dark:text-slate-50 dark:ring-slate-700"
          >
            <p className="text-sm font-bold text-slate-700 dark:text-emerald-200">
              {section.title}
            </p>

            {paragraphLines.length > 0 && (
              <div className="mt-2 space-y-2 text-sm leading-relaxed dark:text-slate-200">
                {paragraphLines.map((line, lineIndex) => (
                  <p key={lineIndex}>{line}</p>
                ))}
              </div>
            )}

            {bulletLines.length > 0 && (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed dark:text-slate-200">
                {bulletLines.map((line, lineIndex) => (
                  <li key={lineIndex}>{line.replace(/^[-•]\s*/, '')}</li>
                ))}
              </ul>
            )}

            {orderedLines.length > 0 && (
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm leading-relaxed dark:text-slate-200">
                {orderedLines.map((line, lineIndex) => {
                  const cleaned = line.replace(/^\d+\.\s*/, '');
                  return <li key={lineIndex}>{cleaned}</li>;
                })}
              </ol>
            )}
          </div>
        );
      })}
    </div>
  );
};

const AIExplanationChat: React.FC<AIExplanationChatProps> = ({ question, isOpen, onClose }) => {
  const [messages, setMessages] = useState<ExplanationChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const latestMessages = useRef<ExplanationChatMessage[]>([]);

  useEffect(() => {
    if (!isOpen) {
      setMessages([]);
      latestMessages.current = [];
      setInputValue('');
      setError(null);
      setIsLoading(false);
      return;
    }

    setMessages([]);
    latestMessages.current = [];
    setInputValue('');
    setError(null);
    setIsLoading(false);
  }, [isOpen, question.id]);

  useEffect(() => {
    if (endRef.current) {
      endRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const sendMessage = async (message: ExplanationChatMessage) => {
    const history = [...latestMessages.current, message];
    setMessages(history);
    latestMessages.current = history;
    setIsLoading(true);
    setError(null);
    try {
      const reply = await sendExplanationFollowUpMessage(question, history);
      let combinedReply = reply;
      let continuationHistory = [...history, { role: 'assistant', content: reply }];
      let continuationCount = 0;

      while (shouldRequestContinuation(combinedReply) && continuationCount < 5) {
        const continuationPrompt: ExplanationChatMessage = {
          role: 'user',
          content: '이어서 계속 설명해줘. 앞에서 끊긴 부분부터.'
        };
        const continuationReply = await sendExplanationFollowUpMessage(
          question,
          [...continuationHistory, continuationPrompt]
        );
        if (!continuationReply.trim()) {
          break;
        }
        combinedReply = `${combinedReply.trim()}\n${continuationReply.trim()}`;
        continuationHistory = [...continuationHistory, continuationPrompt, { role: 'assistant', content: continuationReply }];
        continuationCount += 1;
      }

      const assistantMessage: ExplanationChatMessage = { role: 'assistant', content: combinedReply };
      const updatedHistory = [...history, assistantMessage];
      setMessages(updatedHistory);
      latestMessages.current = updatedHistory;
    } catch (err) {
      console.error(err);
      setError(typeof (err?.message) === 'string' ? err.message : 'AI ?? ?? ??? ???? ?????. ?? ? ?? ??????.');
      latestMessages.current = history;
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isLoading) return;
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    setInputValue('');
    await sendMessage({ role: 'user', content: trimmed });
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-8">
      <div className="flex w-full max-w-3xl flex-col rounded-2xl bg-white shadow-2xl dark:bg-slate-900 max-h-[90vh] h-[90vh]">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-700 shrink-0">
          <div>
            <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">AI 해설 채팅</p>
            <p className="text-base font-bold text-slate-900 dark:text-slate-100">{question.subject || '문제'}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-full border border-slate-200 px-3 py-1 text-sm font-medium text-slate-500 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            닫기
          </button>
        </div>

        <div className="border-b border-slate-100 px-6 py-4 text-sm text-slate-600 dark:border-slate-800 dark:text-slate-300 overflow-y-auto max-h-[240px] shrink-0">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">문제 요약</p>
          <FormattedText text={question.questionText} />
          <ul className="mt-3 space-y-1 text-xs text-slate-500 dark:text-slate-400">
            {(question.options || []).map((option, index) => (
              <li key={index}>
                <span className="font-semibold text-slate-600 dark:text-slate-100">{String.fromCharCode(65 + index)}.</span>{' '}
                {option}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-1 flex-col min-h-0">
          <div className="flex-1 min-h-[260px] space-y-4 overflow-y-auto px-6 py-4">
            {messages.length === 0 && (
              <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                이 문제에 대해 궁금한 점이 있으면 자유롭게 질문해 주세요.
              </div>
            )}
            {messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`w-full max-w-full rounded-2xl px-4 py-3 text-sm md:max-w-[85%] ${
                    message.role === 'user'
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100'
                  }`}
                >
                  {message.role === 'assistant'
                    ? renderAssistantContent(message.content)
                    : message.content}
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start">
                <div className="rounded-2xl bg-slate-100 px-4 py-3 text-sm text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                  AI가 해설을 정리하고 있습니다...
                </div>
              </div>
            )}
            {error && (
              <div className="text-center text-sm text-red-500">
                {error}
              </div>
            )}
            <div ref={endRef} />
          </div>

          <form onSubmit={handleSubmit} className="border-t border-slate-100 px-6 py-4 dark:border-slate-800 shrink-0">
            <label htmlFor="ai-explanation-input" className="sr-only">AI에게 질문 입력</label>
            <div className="flex items-end gap-3">
              <textarea
                id="ai-explanation-input"
                className="min-h-[60px] flex-1 rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-700 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:focus:ring-blue-500"
                placeholder="이 문제에서 궁금한 점을 입력해 주세요."
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                disabled={isLoading}
              />
              <button
                type="submit"
                disabled={isLoading || inputValue.trim().length === 0}
                className="rounded-2xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-lg transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-400 dark:shadow-none"
              >
                전송
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default AIExplanationChat;
