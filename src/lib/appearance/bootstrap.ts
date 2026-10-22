import { themeToCSS, FONT_STACKS } from './css';
import { getTheme, BUILTIN_THEMES } from './registry';
import { validateThemePackage } from './validation';
import type { AppearanceSettings } from './types';

export const APPEARANCE_CACHE_KEY = 'lattice-appearance-v1';
export function writeAppearanceCache(appearance: AppearanceSettings, mode: 'light' | 'dark' | 'system'): void {
  if (typeof window === 'undefined') return;
  const theme = getTheme(appearance.activeThemeId, appearance.customThemes);
  if (!validateThemePackage(theme).ok) return;
  try {
    window.localStorage.setItem(APPEARANCE_CACHE_KEY, JSON.stringify({ version: 1, id: theme.id, mode, light: themeToCSS(theme, 'light'), dark: themeToCSS(theme, 'dark') }));
  } catch { /* A blocked mirror must not fail the durable desktop store. */ }
}
const fallback = { version: 1, id: 'lattice', mode: 'system', light: themeToCSS(BUILTIN_THEMES[0], 'light'), dark: themeToCSS(BUILTIN_THEMES[0], 'dark') };
const literals: Record<string, string[]> = {
  '--appearance-font-ui': Object.values(FONT_STACKS), '--appearance-font-reading': Object.values(FONT_STACKS),
  '--appearance-font-code': [FONT_STACKS.mono, 'ui-monospace, Consolas, monospace'],
  '--appearance-control-height': ['2.5rem', '2.25rem', '2rem'],
  '--appearance-radius': ['2px', '6px', '12px'], '--radius': ['2px', '6px', '12px'],
  '--appearance-shadow': ['none', '0 1px 2px rgb(15 23 42 / 0.08)', '0 8px 24px rgb(15 23 42 / 0.12)'],
  '--appearance-motion': ['0ms', '120ms', '180ms'],
};
/** Parser-executed RootLayout constant. Only typed values and readable palettes
 * can reach setProperty; no URL, arbitrary CSS, selectors, eval or provider data. */
export const APPEARANCE_BOOTSTRAP_SCRIPT = `(()=>{
const fallback=${JSON.stringify(fallback)}, literal=${JSON.stringify(literals)}, keys=Object.keys(fallback.light);
const validValue=(key,v)=>{
 if(typeof v!=='string')return false;
 if(literal[key])return literal[key].includes(v);
 if(fallback.light[key][0]==='#')return /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(v)&&v.length===fallback.light[key].length;
 const parts=v.split(' ');return parts.length===3&&/^\\d+(\\.\\d+)?$/.test(parts[0])&&parts[1].endsWith('%')&&parts[2].endsWith('%')&&Number(parts[0])<=360&&Number(parts[0])>=0&&[1,2].every(i=>/^\\d+(\\.\\d+)?%$/.test(parts[i])&&parseFloat(parts[i])>=0&&parseFloat(parts[i])<=100);
};
const luminance=(v)=>{
 let rgb;if(v[0]==='#')rgb=[1,3,5].map(i=>parseInt(v.slice(i,i+2),16)/255);
 else {const [h,s,l]=v.split(' ').map(parseFloat), chroma=(1-Math.abs(2*l/100-1))*s/100, x=chroma*(1-Math.abs((h/60)%2-1)), m=l/100-chroma/2;rgb=(h<60?[chroma,x,0]:h<120?[x,chroma,0]:h<180?[0,chroma,x]:h<240?[0,x,chroma]:h<300?[x,0,chroma]:[chroma,0,x]).map(c=>c+m);}
 return rgb.map(c=>c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4).reduce((sum,c,i)=>sum+c*[0.2126,0.7152,0.0722][i],0);
};
const ratio=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05);};
const validMap=map=>{
 if(!map||Object.keys(map).length!==keys.length||!keys.every(key=>validValue(key,map[key])))return false;
 const surfaces=['--background','--card','--popover','--muted'];
 const texts=['--foreground','--muted-foreground','--primary','--appearance-success','--appearance-warning','--appearance-danger','--appearance-info'];
 return texts.every(text=>surfaces.every(surface=>ratio(map[text],map[surface])>=4.5))&&surfaces.every(surface=>['--ring','--appearance-control-border'].every(control=>ratio(map[control],map[surface])>=3))&&ratio(map['--primary-foreground'],map['--primary'])>=4.5&&ratio(map['--accent-foreground'],map['--accent'])>=4.5;
};
let data=fallback;try{const raw=localStorage.getItem(${JSON.stringify(APPEARANCE_CACHE_KEY)});if(raw&&raw.length<32768){const c=JSON.parse(raw);if(c.version===1&&/^[a-z][a-z0-9-]{1,47}$/.test(c.id)&&['light','dark','system'].includes(c.mode)&&validMap(c.light)&&validMap(c.dark))data=c;}}catch{}
const mode=data.mode==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):data.mode;
const root=document.documentElement;for(const key of keys)root.style.setProperty(key,data[mode][key]);root.classList.toggle('dark',mode==='dark');root.style.colorScheme=mode;root.dataset.appearanceTheme=data.id;root.dataset.appearanceMode=mode;
})()`;
