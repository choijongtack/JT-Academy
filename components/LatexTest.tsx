import React from 'react';
import FormattedText from './FormattedText';

// Simple test component to verify LaTeX rendering
const LatexTest: React.FC = () => {
    const testCases = [
        {
            label: "Simple inline math",
            text: "This is $E = mc^2$ inline"
        },
        {
            label: "Fraction",
            text: "$\\frac{a}{b}$"
        },
        {
            label: "Partial derivative",
            text: "$\\frac{\\partial H}{\\partial t}$"
        },
        {
            label: "Full option (like quiz)",
            text: "Curl $E = \\frac{\\partial H}{\\partial t}$"
        },
        {
            label: "Display mode",
            text: "$$E = mc^2$$"
        }
    ];

    return (
        <div className="p-8 space-y-6 bg-white">
            <h1 className="text-2xl font-bold">LaTeX Rendering Test</h1>

            {testCases.map((test, index) => (
                <div key={index} className="border p-4 rounded">
                    <div className="text-sm font-semibold text-gray-600 mb-2">{test.label}</div>
                    <div className="text-lg">
                        <FormattedText text={test.text} />
                    </div>
                    <div className="text-xs text-gray-400 mt-2">Raw: {test.text}</div>
                </div>
            ))}
        </div>
    );
};

export default LatexTest;
