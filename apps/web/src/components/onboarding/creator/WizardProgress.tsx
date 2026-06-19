"use client";

interface WizardProgressProps {
  steps: string[];
  currentStep: number;
}

export function WizardProgress({ steps, currentStep }: WizardProgressProps) {
  return (
    <nav aria-label="Wizard progress" className="flex items-center justify-between">
      {steps.map((label, index) => {
        const stepNum = index + 1;
        const isComplete = stepNum < currentStep;
        const isCurrent = stepNum === currentStep;

        return (
          <div key={label} className="flex flex-col items-center flex-1">
            <div
              aria-current={isCurrent ? "step" : undefined}
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold border-2 transition-colors ${
                isComplete
                  ? "bg-violet-600 border-violet-600 text-white"
                  : isCurrent
                    ? "bg-white border-violet-600 text-violet-600"
                    : "bg-white border-gray-300 text-gray-400"
              }`}
            >
              {isComplete ? <span aria-hidden="true">✓</span> : <span>{stepNum}</span>}
            </div>
            <span
              className={`mt-1 text-xs text-center ${
                isCurrent ? "text-violet-600 font-medium" : "text-gray-400"
              }`}
            >
              {label}
            </span>
          </div>
        );
      })}
    </nav>
  );
}
