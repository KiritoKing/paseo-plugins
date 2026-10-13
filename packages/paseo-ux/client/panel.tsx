import {useEffect,useMemo,useState,useRef} from 'react';
import {useAgent,usePaseo,useRpc,type PluginAgentPanelProps} from '@getpaseo/plugin/client';
import {FlatList,Icon} from '@getpaseo/plugin/client/react-native';
import {useQuery} from '@tanstack/react-query';
import {Image,Pressable,Text,TextInput,View} from 'react-native';
import {listMedia,readMedia,type MediaAsset} from '../shared/contracts';
import {ImagePreview} from './preview';

export function MediaPanel(props:PluginAgentPanelProps){
  const {agentId,host,theme,layout}=props;const agent=useAgent(agentId,({title})=>({title}));const paseo=usePaseo();const list=useRpc(listMedia);const read=useRpc(readMedia);
  const [assets,setAssets]=useState<MediaAsset[]>([]);const [cursor,setCursor]=useState<{epoch:string;seq:number}|null>(null);const [hasOlder,setHasOlder]=useState(false);
  const [,setEpoch]=useState('');const epochRef=useRef('');const generation=useRef(0);const oldest=useRef<{epoch:string;seq:number}|null>(null);const [loading,setLoading]=useState(true);const [error,setError]=useState('');const [search,setSearch]=useState('');const [preview,setPreview]=useState<number|null>(null);
  useEffect(()=>{
    const activeGeneration=++generation.current;let disposed=false;let busy=false;let timer:ReturnType<typeof setTimeout>|undefined;
    const refresh=async()=>{
      if(busy||disposed)return;busy=true;
      try{const page=await list({agentId});if(disposed)return;
        const reset=!!epochRef.current&&epochRef.current!==page.epoch;
        setAssets(previous=>reset?page.assets:mergeAssets(previous,page.assets));epochRef.current=page.epoch;setEpoch(page.epoch);
        if(reset||!oldest.current){oldest.current=page.cursor;setCursor(page.cursor);setHasOlder(page.hasOlder);}setError('');
      }catch(cause){if(!disposed)setError(cause instanceof Error?cause.message:'媒体列表读取失败');}
      finally{busy=false;if(!disposed)setLoading(false);}
    };
    epochRef.current='';oldest.current=null;setAssets([]);setCursor(null);setEpoch('');setLoading(true);setError('');setPreview(null);void refresh();
    const stop=paseo.agents.ref(agentId).timeline.subscribe(event=>{
      if(disposed||generation.current!==activeGeneration)return;
      if(event.event.type==='error'){setError('会话连接中断，请刷新重试');return;}
      if(event.event.type==='replacement'){epochRef.current='';oldest.current=null;setAssets([]);setCursor(null);setEpoch('');setPreview(null);}
      if(timer)clearTimeout(timer);timer=setTimeout(()=>void refresh(),600);
    });
    void stop.ready.catch(()=>{if(!disposed)setError('媒体实时更新连接失败，请刷新重试');});
    return ()=>{disposed=true;stop();if(timer)clearTimeout(timer);};
  },[agentId,list,paseo]);
  const filtered=useMemo(()=>assets.filter(asset=>`${asset.label} ${asset.source}`.toLowerCase().includes(search.toLowerCase())).sort((a,b)=>b.seq-a.seq),[assets,search]);
  const reload=async(older=false)=>{
    if(loading)return;const activeGeneration=generation.current;setLoading(true);
    try{const page=await list({agentId,...(older&&cursor?{cursor}:{})});if(generation.current!==activeGeneration)return;const reset=!!epochRef.current&&epochRef.current!==page.epoch;setAssets(previous=>reset?page.assets:mergeAssets(previous,page.assets));epochRef.current=page.epoch;setEpoch(page.epoch);if(older||reset||!oldest.current){oldest.current=page.cursor;setCursor(page.cursor);setHasOlder(page.hasOlder);}setError('');}
    catch(cause){if(generation.current===activeGeneration)setError(cause instanceof Error?cause.message:'媒体列表读取失败');}finally{if(generation.current===activeGeneration)setLoading(false);}
  };
  const openImages=filtered.map(asset=>({source:asset.source,label:asset.label,uri:''}));
  const resolve=async(image:{source:string})=>{
    const asset=filtered.find(asset=>asset.source===image.source);if(!asset)throw new Error('图片已不在当前列表中');
    return (await read({agentId,assetId:asset.id})).uri;
  };
  const columns=layout.compact?2:3;
  return <View testID="paseo-ux-media-panel" style={{flex:1,backgroundColor:theme.colors.surface0,padding:16,gap:12}}>
    <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center'}}><View style={{gap:4}}><Text style={{color:theme.colors.foreground,fontWeight:'600',fontSize:17}}>会话媒体</Text><Text numberOfLines={1} style={{color:theme.colors.foregroundMuted,fontSize:12}}>{agent?.title??'当前会话'}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="刷新媒体列表" onPress={()=>void reload()} disabled={loading} style={{padding:8}}><Icon name="RefreshCw" size={17} color={theme.colors.foregroundMuted}/></Pressable></View>
    <View style={{flexDirection:'row',alignItems:'center',gap:8}}><Text style={{color:theme.colors.accent,fontSize:12}}>图片 · {assets.length}</Text><Text style={{color:theme.colors.foregroundMuted,fontSize:11}}>{hasOlder?'已加载部分历史':'全部已加载'}</Text></View>
    <TextInput accessibilityLabel="搜索会话图片" placeholder="搜索图片名称或路径" placeholderTextColor={theme.colors.foregroundMuted} value={search} onChangeText={setSearch} style={{color:theme.colors.foreground,backgroundColor:theme.colors.surface1,borderWidth:1,borderColor:theme.colors.border,borderRadius:8,padding:10,fontSize:12}}/>
    {error?<View style={{padding:12,gap:8,backgroundColor:theme.colors.surface1,borderRadius:8}}><Text style={{color:theme.colors.foreground}}>{error}</Text><Pressable onPress={()=>void reload()} accessibilityRole="button"><Text style={{color:theme.colors.accent}}>重试</Text></Pressable></View>:null}
    <FlatList key={columns} data={filtered} numColumns={columns} style={{flex:1,minHeight:0}} initialNumToRender={12} windowSize={3} maxToRenderPerBatch={6} keyExtractor={asset=>asset.id} renderItem={({item,index})=><MediaTile asset={item} agentId={agentId} hostId={host.id} theme={theme} onPress={()=>setPreview(index)}/>} ListEmptyComponent={<Text style={{color:theme.colors.foregroundMuted,padding:24,textAlign:'center'}}>{loading?'正在读取会话图片…':search?'没有匹配的图片':'这段会话还没有图片'}</Text>} ListFooterComponent={hasOlder?<Pressable accessibilityRole="button" onPress={()=>void reload(true)} disabled={loading} style={{padding:16,alignItems:'center'}}><Text style={{color:theme.colors.accent}}>{loading?'正在加载…':'加载更早的媒体'}</Text></Pressable>:null}/>
    {preview!==null?<ImagePreview {...props} images={openImages} index={preview} onClose={()=>setPreview(null)} resolve={resolve}/>:null}
  </View>;
}

function mergeAssets(previous:MediaAsset[],next:MediaAsset[]){const map=new Map(previous.map(asset=>[asset.id,asset]));let changed=false;for(const asset of next){const old=map.get(asset.id);if(!old||old.label!==asset.label||old.seq!==asset.seq||old.timestamp!==asset.timestamp){map.set(asset.id,asset);changed=true;}}return changed?[...map.values()]:previous;}

function MediaTile({asset,agentId,hostId,theme,onPress}:{asset:MediaAsset;agentId:string;hostId:string;theme:PluginAgentPanelProps['theme'];onPress:()=>void}){
  const read=useRpc(readMedia);const [failed,setFailed]=useState(false);
  const query=useQuery({queryKey:['paseo-ux-image',hostId,agentId,asset.id],queryFn:()=>read({agentId,assetId:asset.id}),staleTime:60_000,gcTime:60_000,retry:false});
  return <Pressable accessibilityRole="button" accessibilityLabel={`预览 ${asset.label}`} onPress={onPress} style={{flex:1,margin:4,borderRadius:9,borderWidth:1,borderColor:theme.colors.border,overflow:'hidden',backgroundColor:theme.colors.surface1}}>
    <View style={{height:100,alignItems:'center',justifyContent:'center',backgroundColor:theme.colors.surface2}}>{query.data&&!failed?<Image source={{uri:query.data.uri}} resizeMode="contain" style={{width:'100%',height:'100%'}} onError={()=>setFailed(true)}/>:<View style={{alignItems:'center',gap:6}}><Icon name={query.isError||failed?'ImageOff':'Image'} color={theme.colors.foregroundMuted} size={22}/><Text style={{color:theme.colors.foregroundMuted,fontSize:10}}>{query.isError||failed?'点击重试预览':'加载中'}</Text></View>}</View>
    <View style={{padding:8,gap:3}}><Text numberOfLines={1} style={{color:theme.colors.foreground,fontSize:11}}>{asset.label}</Text><Text style={{color:theme.colors.foregroundMuted,fontSize:10}}>{asset.origin==='tool'?'工具输出':asset.origin==='user'?'用户发送':'助手回复'}</Text></View>
  </Pressable>;
}
