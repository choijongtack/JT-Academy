// components/FormattedText.tsx

import React, { useEffect, useRef, memo } from 'react';
import katex from 'katex';
// KaTeX CSS is loaded from CDN in index.html

interface FormattedTextProps {
    text: string;
}

// LaTeX 수식을 DOM에 렌더링하는 전용 컴포넌트
const Latex: React.FC<{ latex: string; displayMode?: boolean }> = ({ latex, displayMode = false }) => {
    const containerRef = useRef<HTMLSpanElement>(null);

    useEffect(() => {
        if (containerRef.current) {
            try {
                // Preprocess LaTeX to fix common errors
                let processedLatex = latex
                    // Fix: Replace "Curl~E" with "\text{Curl } E"
                    .replace(/Curl~([A-Z])/g, '\\text{Curl } $1')
                    // Fix: Replace standalone ~ with proper space
                    .replace(/~/g, ' ')
                    // Fix: Ensure \mathbf is used correctly
                    .replace(/\\mathbf\{([^}]+)\}/g, '\\mathbf{$1}');

                if (import.meta.env.DEV) {
                    console.log('?? LaTeX Debug:');
                    console.log('  Original:', latex);
                    console.log('  Processed:', processedLatex);
                }

                // KaTeX ?????? ???? LaTeX ??? HTML? ??? DOM? ??
                katex.render(processedLatex, containerRef.current, {
                    throwOnError: false, // ?? ?? ? ?? ??
                    displayMode: displayMode,
                });

                // Check if KaTeX CSS is loaded
                const katexElement = containerRef.current.querySelector('.katex');
                if (katexElement) {
                    const computedStyle = window.getComputedStyle(katexElement);
                    if (import.meta.env.DEV) {
                        console.log('? LaTeX rendered successfully');
                        console.log('  KaTeX element found:', katexElement.className);
                        console.log('  Font family:', computedStyle.fontFamily);
                        console.log('  HTML output:', containerRef.current.innerHTML.substring(0, 200));
                        console.log('  Display:', computedStyle.display);
                        console.log('  Visibility:', computedStyle.visibility);

                        if (computedStyle.fontFamily.includes('KaTeX')) {
                            console.log('  ? KaTeX CSS is loaded!');
                        } else {
                            console.error('  ? KaTeX CSS NOT loaded! Font:', computedStyle.fontFamily);
                            console.error('  ? Check if katex.min.css is loading in Network tab');
                        }
                    }
                } else if (import.meta.env.DEV) {
                    console.warn('?? No .katex element found in rendered output');
                    console.warn('  Container HTML:', containerRef.current.innerHTML);
                }
            } catch (e) {
                if (import.meta.env.DEV) {
                    console.error('? KaTeX rendering error:');
                    console.error('  Input:', latex);
                    console.error('  Error:', e);
                }
                // 렌더링 실패 시 원본 코드를 Fallback으로 표시
                containerRef.current.textContent = displayMode ? `$$${latex}$$` : `$${latex}$`;
            }
        }
    }, [latex, displayMode]);

    return <span ref={containerRef} className="inline-block max-w-full break-words" />;
};


// 텍스트를 일반 텍스트와 LaTeX 수식으로 분할하는 메인 컴포넌트
const FormattedText: React.FC<FormattedTextProps> = memo(({ text }) => {
    if (!text) {
        return null;
    }

    // ₩ 기호를 \ (백슬래시)로 치환 (한글 환경 최적화)
    let normalizedText = text.replace(/₩/g, '\\');

    // 자동 줄바꿈 처리: 번호 매기기 리스트 감지 (1., 2., 3., 4. 등)
    // "1. 첫 번째", "2. 두 번째" 형식을 감지하여 앞에 줄바꿈 추가
    normalizedText = normalizedText.replace(/(\d+\.\s+)/g, '\n$1').trim();

    // 긴 문장 단락 나누기: 한국어 문장 종결 후 줄바꿈 추가
    // 마침표(.), 물음표(?), 느낌표(!) 뒤에 공백이 있고 다음에 한글이나 숫자가 오는 경우
    // 단, 수식 내부의 마침표는 제외 ($ 안에 있는 경우)
    normalizedText = normalizedText.replace(/([.?!])\s+(?=[가-힣A-Z\d])/g, '$1\n');

    // LaTeX 명령어 포함 여부 확인 (AI 데이터의 안전장치)
    const hasLatexCommands = /\\(frac|partial|sqrt|times|pm|theta|pi|infty|int|sum|lim|alpha|beta|omega|Omega|mu|epsilon|lambda|sigma|rho|phi|cdot|approx|neq|le|ge|nabla|text|overline)/.test(normalizedText);
    const hasDelimiters = /\$\$|\$/.test(normalizedText);

    const wrapLooseLatex = (input: string) => {
        if (!hasLatexCommands || hasDelimiters) {
            return input;
        }
        return input.replace(/\\[a-zA-Z]+(?:\{[^}]*\})?(?:[\\^_{}()=+\-*/.,0-9A-Za-z\s]|\\[a-zA-Z]+)*/g, (match) => {
            const trimmed = match.trim();
            if (!trimmed) return match;
            return `$${trimmed}$`;
        });
    };

    const finalText = wrapLooseLatex(normalizedText);

    const parts = finalText.split(/(\$\$[\s\S]*?\$\$|\$[^$]*?\$)/g);

    return (
        <div className="text-slate-800 dark:text-slate-200 leading-relaxed break-all max-w-full">
            {parts.map((part, i) => {
                // 디스플레이 모드 수식 (센터 정렬)
                if (part.startsWith('$$') && part.endsWith('$$')) {
                    const latex = part.slice(2, -2);
                    return <Latex key={i} latex={latex} displayMode={true} />;
                }
                // 인라인 모드 수식
                if (part.startsWith('$') && part.endsWith('$')) {
                    const latex = part.slice(1, -1);
                    return <Latex key={i} latex={latex} displayMode={false} />;
                }
                // 일반 텍스트 - 줄바꿈 처리
                const lines = part.split('\n');
                return (
                    <span key={i}>
                        {lines.map((line, lineIdx) => (
                            <React.Fragment key={lineIdx}>
                                {line}
                                {lineIdx < lines.length - 1 && <br />}
                            </React.Fragment>
                        ))}
                    </span>
                );
            })}
        </div>
    );
});

export default FormattedText;
