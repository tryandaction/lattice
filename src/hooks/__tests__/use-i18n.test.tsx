import { useLayoutEffect } from 'react';
import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useI18n } from '../use-i18n';
import { getLocale, setLocale } from '@/lib/i18n';

function Label() {
  const { locale, t } = useI18n();
  return <span data-testid="locale-label">{locale}:{t('settings.language')}</span>;
}

describe('locale external store subscription', () => {
  beforeEach(() => { setLocale('zh-CN'); document.documentElement.lang = 'zh-CN'; });

  it('observes a locale switch between render and the passive subscription effect', () => {
    function SwitchDuringCommit() {
      useLayoutEffect(() => { setLocale('en-US'); }, []);
      return null;
    }
    render(<><Label /><SwitchDuringCommit /></>);
    expect(screen.getByTestId('locale-label').textContent).toBe('en-US:Language');
    expect(getLocale()).toBe('en-US');
  });

  it('keeps mounted translations and the document language aligned across switches', () => {
    render(<Label />);
    act(() => setLocale('en-US'));
    expect(screen.getByTestId('locale-label').textContent).toBe('en-US:Language');
    expect(document.documentElement.lang).toBe('en-US');
    act(() => setLocale('zh-CN'));
    expect(screen.getByTestId('locale-label').textContent).toContain('zh-CN:');
    expect(document.documentElement.lang).toBe('zh-CN');
  });
});
