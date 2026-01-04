'use client';

import { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';
import { useI18n } from '@/hooks/use-i18n';
import { useSettingsStore } from '@/stores/settings-store';
import { LanguageSelector } from '@/components/settings/language-selector';
import { ThemeSelector } from '@/components/settings/theme-selector';
import { FolderSelector } from '@/components/settings/folder-selector';

type OnboardingStep = 'welcome' | 'language' | 'theme' | 'folder' | 'complete';

const steps: OnboardingStep[] = ['welcome', 'language', 'theme', 'folder', 'complete'];

export function OnboardingWizard() {
  const { t } = useI18n();
  const [currentStep, setCurrentStep] = useState<OnboardingStep>('welcome');
  const [isVisible, setIsVisible] = useState(false);
  const completeOnboarding = useSettingsStore((state) => state.completeOnboarding);
  const onboardingCompleted = useSettingsStore((state) => state.settings.onboardingCompleted);
  const isInitialized = useSettingsStore((state) => state.isInitialized);

  useEffect(() => {
    if (isInitialized && !onboardingCompleted) {
      // Small delay for smooth appearance
      const timer = setTimeout(() => setIsVisible(true), 100);
      return () => clearTimeout(timer);
    }
  }, [isInitialized, onboardingCompleted]);

  if (!isVisible || onboardingCompleted) return null;

  const currentIndex = steps.indexOf(currentStep);
  const isFirst = currentIndex === 0;
  const isLast = currentIndex === steps.length - 1;

  const goNext = () => {
    if (!isLast) {
      setCurrentStep(steps[currentIndex + 1]);
    }
  };

  const goBack = () => {
    if (!isFirst) {
      setCurrentStep(steps[currentIndex - 1]);
    }
  };

  const handleSkip = async () => {
    await completeOnboarding();
    setIsVisible(false);
  };

  const handleComplete = async () => {
    await completeOnboarding();
    setIsVisible(false);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative w-full max-w-lg mx-4 bg-background rounded-2xl shadow-2xl border border-border overflow-hidden">
        {/* Progress indicator */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-muted">
          <div 
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${((currentIndex + 1) / steps.length) * 100}%` }}
          />
        </div>

        {/* Content */}
        <div className="p-8">
          {currentStep === 'welcome' && <WelcomeStep />}
          {currentStep === 'language' && <LanguageStep />}
          {currentStep === 'theme' && <ThemeStep />}
          {currentStep === 'folder' && <FolderStep />}
          {currentStep === 'complete' && <CompleteStep />}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-8 py-4 border-t border-border bg-muted/30">
          <div>
            {!isFirst && !isLast && (
              <button
                onClick={goBack}
                className="flex items-center gap-1 px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
                {t('common.back')}
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* Step dots */}
            <div className="flex gap-1.5 mr-4">
              {steps.map((step, index) => (
                <div
                  key={step}
                  className={`w-2 h-2 rounded-full transition-colors ${
                    index <= currentIndex ? 'bg-primary' : 'bg-muted-foreground/30'
                  }`}
                />
              ))}
            </div>

            {currentStep === 'welcome' && (
              <>
                <button
                  onClick={handleSkip}
                  className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  {t('common.skip')}
                </button>
                <button
                  onClick={goNext}
                  className="flex items-center gap-1 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
                >
                  {t('common.next')}
                  <ChevronRight className="h-4 w-4" />
                </button>
              </>
            )}

            {(currentStep === 'language' || currentStep === 'theme') && (
              <button
                onClick={goNext}
                className="flex items-center gap-1 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
              >
                {t('common.next')}
                <ChevronRight className="h-4 w-4" />
              </button>
            )}

            {currentStep === 'folder' && (
              <>
                <button
                  onClick={goNext}
                  className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  {t('onboarding.folder.skip')}
                </button>
                <button
                  onClick={goNext}
                  className="flex items-center gap-1 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
                >
                  {t('common.next')}
                  <ChevronRight className="h-4 w-4" />
                </button>
              </>
            )}

            {currentStep === 'complete' && (
              <button
                onClick={handleComplete}
                className="flex items-center gap-2 px-6 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
              >
                <Sparkles className="h-4 w-4" />
                {t('onboarding.getStarted')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function WelcomeStep() {
  const { t } = useI18n();
  
  return (
    <div className="text-center py-8">
      <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
        <Sparkles className="h-10 w-10 text-white" />
      </div>
      <h2 className="text-2xl font-bold mb-2">{t('onboarding.welcome')}</h2>
      <p className="text-muted-foreground mb-4">{t('onboarding.welcome.description')}</p>
      <p className="text-sm text-muted-foreground">{t('onboarding.welcome.subtitle')}</p>
    </div>
  );
}

function LanguageStep() {
  const { t } = useI18n();
  
  return (
    <div className="py-4">
      <h2 className="text-xl font-semibold mb-2 text-center">{t('onboarding.language.title')}</h2>
      <p className="text-sm text-muted-foreground mb-6 text-center">{t('onboarding.language.description')}</p>
      <div className="flex justify-center">
        <LanguageSelector compact />
      </div>
    </div>
  );
}

function ThemeStep() {
  const { t } = useI18n();
  
  return (
    <div className="py-4">
      <h2 className="text-xl font-semibold mb-2 text-center">{t('onboarding.theme.title')}</h2>
      <p className="text-sm text-muted-foreground mb-6 text-center">{t('onboarding.theme.description')}</p>
      <div className="flex justify-center">
        <ThemeSelector compact />
      </div>
    </div>
  );
}

function FolderStep() {
  const { t } = useI18n();
  
  return (
    <div className="py-4">
      <h2 className="text-xl font-semibold mb-2 text-center">{t('onboarding.folder.title')}</h2>
      <p className="text-sm text-muted-foreground mb-6 text-center">{t('onboarding.folder.description')}</p>
      <FolderSelector compact />
    </div>
  );
}

function CompleteStep() {
  const { t } = useI18n();
  
  return (
    <div className="text-center py-8">
      <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-green-500/10 flex items-center justify-center">
        <svg className="h-10 w-10 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <h2 className="text-2xl font-bold mb-2">{t('onboarding.complete.title')}</h2>
      <p className="text-muted-foreground">{t('onboarding.complete.description')}</p>
    </div>
  );
}
