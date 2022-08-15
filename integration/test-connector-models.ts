/*--------------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*-------------------------------------------------------------------------------------------------*/

import { GroupInformationModel } from '@itwin/core-backend';

// To self: I copied this file verbatim from the test connector in the connector framework; I have
// exactly zero idea what it does at the moment.

/** A container for persisting AnalyticalElement instances used to model a specialized analytical perspective.
 * @beta
 */
export abstract class TestConnectorGroupModel extends GroupInformationModel {
  /** @internal */
  public static override get className(): string { return 'TestConnectorGroupModel'; }
}
