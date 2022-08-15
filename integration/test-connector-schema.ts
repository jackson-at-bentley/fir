/*--------------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*-------------------------------------------------------------------------------------------------*/

import * as path from 'node:path';
import * as url from 'node:url';

import { ClassRegistry, Schema, Schemas } from '@itwin/core-backend';
import * as elementsModule from './test-connector-elements.js';
import * as modelsModule from './test-connector-models.js';

// To self: I copied this file verbatim from the test connector in the connector framework; I have
// exactly zero idea what it does at the moment.

/** Schema class for the TestConnector domain.
 * @beta
 */
export class TestConnectorSchema extends Schema {
  public static override get schemaName(): string { return 'TestConnector'; }
  public static get schemaFilePath(): string {
    const root = path.dirname(url.fileURLToPath(import.meta.url));
    return path.join(root, 'assets', 'test-connector.ecschema.xml');
  }
  public static registerSchema() {
    if (this !== Schemas.getRegisteredSchema(this.schemaName)) {
      Schemas.unregisterSchema(this.schemaName);
      Schemas.registerSchema(this);

      ClassRegistry.registerModule(elementsModule, this);
      ClassRegistry.registerModule(modelsModule, this);
    }
  }
}
