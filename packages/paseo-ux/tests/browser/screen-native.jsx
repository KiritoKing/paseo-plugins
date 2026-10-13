import React from 'react';
export const Platform={OS:'web'};
function properties({testID,accessibilityRole,accessibilityLabel,style,children,...rest}){return {'data-testid':testID,role:accessibilityRole,'aria-label':accessibilityLabel,style,...rest};}
export function View({children,style,...props}){return <div {...properties(props)} style={{position:'relative',display:'flex',flexDirection:'column',...style}}>{children}</div>;}
export function Text({children,numberOfLines,selectable,...props}){return <span {...properties(props)}>{children}</span>;}
export function Pressable({children,onPress,style,...props}){return <button {...properties(props)} onClick={onPress} style={{font:'inherit',textAlign:'left',background:'transparent',borderWidth:0,borderStyle:'solid',...style}}>{children}</button>;}
export function TextInput({onChangeText,placeholderTextColor,...props}){return <input {...properties(props)} onChange={event=>onChangeText?.(event.target.value)}/>;}
export function Image({source,resizeMode,accessibilityLabel,style,...props}){
 const transform=style?.transform?.map(part=>Object.entries(part).map(([key,value])=>`${key}(${value}${key.startsWith('translate')?'px':''})`).join(' ')).join(' ');
 return <img {...properties(props)} alt={accessibilityLabel} src={source?.uri} style={{...style,transform,objectFit:resizeMode}}/>;
}
