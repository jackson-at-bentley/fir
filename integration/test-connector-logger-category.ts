/*--------------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*-------------------------------------------------------------------------------------------------*/

// To self: I copied this file verbatim from the test connector in the connector framework; I have
// exactly zero idea what it does at the moment.

/** @packageDocumentation
 * @module Logging
 */

/** Logger categories used by this package
 * @note All logger categories in this package start with the `itwin-connector-framework` prefix.
 * @see [Logger]($bentley)
 * @public
 */
export enum TestConnectorLoggerCategory {
  /** The logger category used by the following classes:
   * - [[ConnectorSynchronizer]]
   */
  Connector = "TestConnector.Connector",
  Geometry = "TestConnector.Geometry",
}
