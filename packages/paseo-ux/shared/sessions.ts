import {defineRpc} from '@getpaseo/plugin';
import {z} from 'zod';
export const sessionSchema=z.object({id:z.string(),workspaceId:z.string(),title:z.string(),provider:z.string(),status:z.string(),createdAt:z.string(),updatedAt:z.string(),archivedAt:z.string().nullable(),canRestore:z.boolean()});
export type WorkspaceSession=z.infer<typeof sessionSchema>;
export const listSessions=defineRpc({name:'sessions.list',input:z.object({workspaceId:z.string().min(1)}),output:z.object({workspaceName:z.string(),sessions:z.array(sessionSchema)})});
export const restoreSession=defineRpc({name:'sessions.restore',input:z.object({workspaceId:z.string().min(1),agentId:z.string().optional()}),output:z.object({agentId:z.string(),workspaceId:z.string(),restored:z.boolean()})});
export function isClosed(session:WorkspaceSession){return !!session.archivedAt||session.status==='closed';}
export function orderedClosed(sessions:readonly WorkspaceSession[],restorableOnly=true){return sessions.filter(s=>isClosed(s)&&(!restorableOnly||s.canRestore)).sort((a,b)=>(b.archivedAt??b.updatedAt).localeCompare(a.archivedAt??a.updatedAt));}
