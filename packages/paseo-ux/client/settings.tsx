import {useSettings,type PluginSurfaceProps} from '@getpaseo/plugin/client';
import {SettingsSection,SettingsSwitch,SettingsSelect} from '@getpaseo/plugin/client/ui';
import {Text,View} from 'react-native';
import {mediaSettings} from '../shared/contracts';

export function MediaSettings({theme}:PluginSurfaceProps){
  const state=useSettings(mediaSettings);
  if(state.status!=='ready')return <Text style={{color:theme.colors.foregroundMuted,padding:16}}>正在读取媒体设置…</Text>;
  const save=(patch:Partial<typeof state.values>)=>{void state.save({...state.values,...patch},state.revision).catch(()=>{});};
  return <View style={{padding:20,gap:12}}><SettingsSection title="媒体预览增强" info="聚合连续图片，保留普通聊天和原生图片加载反馈。">
    <SettingsSwitch label="聊天内图片聚合" hint="桌面和 Web 生效；会话媒体面板仍可独立使用。" value={state.values.enabled} onValueChange={enabled=>save({enabled})} disabled={state.saving}/>
    <SettingsSelect label="默认显示缩略图" value={String(state.values.previewCount)} options={[1,2,3,4,6,8].map(n=>({label:`${n} 张`,value:String(n)}))} onValueChange={value=>save({previewCount:Number(value)})} disabled={state.saving}/>
    {state.saveError?<Text style={{color:theme.colors.foreground}}>{state.saveError}</Text>:null}
  </SettingsSection></View>;
}
