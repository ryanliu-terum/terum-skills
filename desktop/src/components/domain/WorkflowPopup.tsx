import type { ComponentProps } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { DialogPopup } from '../ui/Dialog';

export function WorkflowPopup(props:ComponentProps<typeof Dialog.Popup>){
  return <DialogPopup {...props}/>;
}
