import { QueryClient } from '@tanstack/react-query';
import { expect, it } from 'vitest';
import type { AppUpdateStatus } from '../backend/types';
import { recordAppUpdateError, stagedAppUpdate } from './app-update';
const ready:AppUpdateStatus={appVersion:'0.12.1',supported:true,cliVersion:'0.12.1',latest:'0.12.2',latestAt:null,probe:'cached',probeError:null,staged:'0.12.2',installed:[],lastApply:null,newer:true,ppid:42};
it.each([null,{...ready,supported:false},{...ready,newer:false},{...ready,latest:null},{...ready,staged:null},{...ready,installed:['0.12.2']}])('rejects an ineligible staged observation: %j',status=>{
 expect(stagedAppUpdate(status)).toBeNull();
});
it('uses the same eligible release for the chip, row, and automatic policies',()=>{
 expect(stagedAppUpdate(ready)).toBe('0.12.2');
});
it('retains independent diagnostics instead of overwriting an unrelated failure',()=>{
 const client=new QueryClient();recordAppUpdateError(client,'stage',new Error('download failed'));recordAppUpdateError(client,'arm','shell failed');
 expect(client.getQueryData(['app-update-policy-outcome'])).toEqual({stage:'download failed',arm:'shell failed'});client.clear();
});
