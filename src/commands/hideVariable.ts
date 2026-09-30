/** Hide one variable again, from the tree view. */

import { EnvVariableItem } from '../views/EnvironmentTreeItem';
import type { CommandContext } from './types';

export function hideVariable(context: CommandContext) {
  return (item?: EnvVariableItem): void => {
    if (!(item instanceof EnvVariableItem)) {
      return;
    }
    context.reveals.hide(item.uri, item.variable.id);
  };
}
