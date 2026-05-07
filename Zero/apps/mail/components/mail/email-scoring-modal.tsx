import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { CheckCircle2, XCircle } from 'lucide-react';
import { useEffect } from 'react';

type ProgressStep = 'reading_input' | 'calculating_score' | 'completed';

interface EmailScoringModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  progressStep: ProgressStep;
  pass?: boolean;
}

const STEP_LABELS: Record<ProgressStep, string> = {
  reading_input: 'Reading reply...',
  calculating_score: 'Evaluating...',
  completed: 'Done',
};

export function EmailScoringModal({
  open,
  onOpenChange,
  progressStep,
  pass,
}: EmailScoringModalProps) {
  const isCompleted = progressStep === 'completed';
  const isPass = isCompleted && pass === true;
  const isFail = isCompleted && pass === false;

  useEffect(() => {
    if (isCompleted && open) {
      const timer = setTimeout(() => {
        onOpenChange(false);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [isCompleted, open, onOpenChange]);

  const steps: ProgressStep[] = ['reading_input', 'calculating_score'];
  const currentStepIndex = steps.indexOf(progressStep);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showOverlay
        className="bg-panelLight dark:bg-panelDark w-full max-w-[500px]"
        onPointerDownOutside={(e) => {
          if (!isCompleted) {
            e.preventDefault();
          }
        }}
        onEscapeKeyDown={(e) => {
          if (!isCompleted) {
            e.preventDefault();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-center">
            {isPass ? 'Reply approved' : isFail ? 'Reply not approved' : 'Checking reply'}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {isPass
              ? 'Reply passed the quality check; funds will be released to your wallet'
              : isFail
                ? 'Reply did not pass the quality check; funds will be returned to the sender'
                : 'Reply is being checked'}
          </DialogDescription>
        </DialogHeader>

        <div className="py-6">
          {!isCompleted && (
            <div className="space-y-6">
              {steps.map((step, index) => {
                const isActive = index === currentStepIndex;
                const isStepCompleted = index < currentStepIndex;

                return (
                  <div key={step} className="flex items-center gap-4">
                    <div className="flex-shrink-0">
                      {isStepCompleted ? (
                        <CheckCircle2 className="h-6 w-6 text-green-500" />
                      ) : isActive ? (
                        <Spinner size={24} color="currentColor" />
                      ) : (
                        <div className="h-6 w-6 rounded-full border-2 border-gray-300 dark:border-gray-600" />
                      )}
                    </div>
                    <div className="flex-1">
                      <p
                        className={`text-sm ${
                          isActive
                            ? 'font-medium text-black dark:text-white'
                            : isStepCompleted
                              ? 'text-gray-600 dark:text-gray-400'
                              : 'text-gray-400 dark:text-gray-500'
                        }`}
                      >
                        {STEP_LABELS[step]}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {isPass && (
            <div className="flex flex-col items-center justify-center space-y-4 py-4">
              <CheckCircle2 className="h-16 w-16 text-green-500" />
              <p className="text-center text-base font-medium text-black dark:text-white">
                Reply approved — funds released to your wallet.
              </p>
            </div>
          )}

          {isFail && (
            <div className="flex flex-col items-center justify-center space-y-4 py-4">
              <XCircle className="h-16 w-16 text-red-500" />
              <p className="text-center text-base font-medium text-black dark:text-white">
                Reply didn't pass the quality check — funds returning to sender.
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
