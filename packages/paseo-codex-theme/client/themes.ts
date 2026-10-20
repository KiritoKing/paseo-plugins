import type {PluginThemeContribution} from '@getpaseo/plugin';

// Codex-inspired palettes; Paseo derives its native surfaces and semantic colors.
// Paseo also uses this accent for Markdown links, so keep it distinct from text.
export const codexThemes:PluginThemeContribution[]=[
  {
    id:'codex-light',name:'Codex Light',appearance:'light',
    colors:{
      background:'#ffffff',foreground:'#181818',raised:'#fafafa',
      control:'#f3f3f3',border:'#e4e4e4',accent:'#0969da',
      mutedForeground:'#6b6b6b',ring:'#969696',
    },
  },
  {
    id:'codex-dark',name:'Codex Dark',appearance:'dark',
    colors:{
      background:'#181818',foreground:'#ededed',raised:'#222222',
      control:'#2b2b2b',border:'#3a3a3a',accent:'#6cb6ff',
      mutedForeground:'#a3a3a3',ring:'#777777',
    },
  },
];
