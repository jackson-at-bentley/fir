/* eslint-disable @typescript-eslint/no-non-null-assertion */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';

import 'mocha';
import { assert } from 'chai';

import * as backend from '@itwin/core-backend';
import * as bentley from '@itwin/core-bentley';
import * as common from '@itwin/core-common';

import  { grow } from '../integration/test-connector.js';
import { TestConnectorSchema } from '../integration/test-connector-schema.js';

describe('integration', () => {
    const name = 'test-connector';
    const root = path.dirname(url.fileURLToPath(import.meta.url));
    const outputPath = path.join(root, '..', 'side-effects');
    const imodelPath = path.join(outputPath, `${name}.bim`);
    let imodel: backend.SnapshotDb;

    before(async () => {
        const configuration = new backend.IModelHostConfiguration();
        configuration.cacheDir = outputPath;
        configuration.appAssetsDir = path.join(root, '..', 'integration', 'assets');
        await backend.IModelHost.startup(configuration);
        bentley.Logger.initializeToConsole();
        bentley.Logger.setLevelDefault(bentley.LogLevel.Warning);
    });

    after(async () => {
        await backend.IModelHost.shutdown();
    });

    beforeEach(async () => {
        imodel = backend.SnapshotDb.createEmpty(imodelPath, {
            name,
            rootSubject: { name: 'root' }
        });

        assert.exists(backend.IModelHost.appAssetsDir, 'fatal: assets directory is not defined');

        // TODO: What is the difference between registering and importing a schema?
        // https://www.itwinjs.org/learning/backend/schemasandelementsintypescript

        TestConnectorSchema.registerSchema();

        const schema = path.join(backend.IModelHost.appAssetsDir as string, 'test-connector.ecschema.xml');
        await imodel.importSchemas([ schema ]);
    });

    afterEach(() => {
        imodel.close();
        fs.rmSync(imodelPath, { maxRetries: 2, retryDelay: 2 * 1000 });
    });

    it('does not explode', () => {
        assert.doesNotThrow(() => grow(imodel, null));
        imodel.saveChanges('fir all done');
    });

    it('there are 8 small square tiles', async () => {
        grow(imodel, null);
        imodel.saveChanges('fir all done');

        // We use `query` here instead of a prepared statement because it's convenient.

        const query = (
            "select ECInstanceId from only TestConnector:SmallSquareTile"
        );

        const elements: bentley.Id64String[] = [];

        for await (const element of imodel.query(query)) {
            // Danger! AsyncIterableIterator<any>. We pray that nothing explodes.
            elements.push(element);
        }

        assert.strictEqual(elements.length, 8);
    });

    it('writes a small square tile', async () => {
        grow(imodel, null);
        imodel.saveChanges('fir all done');

        // I'm assuming this identifier is scoped to the root subject, but it's not; it's scoped to
        // the repository. I know it's unique though.

        const queryAspect = (
            "select Element.id from only bis:ExternalSourceAspect"
            + " where Identifier='baaa404e-d7c6-46b4-b990-fbb8c2c530aa'"
        );

        const aspects: { 'element.id'? : bentley.Id64String }[] = [];

        for await (const aspect of imodel.query(
            queryAspect, undefined,
            { rowFormat: common.QueryRowFormat.UseJsPropertyNames }
        )) {
            aspects.push(aspect);
        }

        assert.strictEqual(aspects.length, 1);

        assert.exists(aspects[0]['element.id']);
        const id = aspects[0]['element.id']!;

        const queryTile = (
            "select ECInstanceId, Condition from only TestConnector:SmallSquareTile"
            + ` where ECInstanceId=?`
        );

        const tiles: {id?: bentley.Id64String, condition?: string }[] = [];

        for await (const tile of imodel.query(
            queryTile, new common.QueryBinder().bindId(1, id!),
            {rowFormat: common.QueryRowFormat.UseJsPropertyNames }
        )) {
            tiles.push(tile);
        }

        assert.strictEqual(tiles.length, 1);

        assert.strictEqual(tiles[0].condition, 'Scratched');
    });

    it('updates a small square tile', async () => {
        grow(imodel, null);

        imodel.saveChanges('fir all done');

        // Run the connector a second time, this time with changes!

        grow(imodel, { updateTile: {
            anchor: 'baaa404e-d7c6-46b4-b990-fbb8c2c530aa',
            version: '1.0.1',
            userLabel: "This is my favorite tile because it's tiny and square",
            condition: 'Beautiful',
        }});

        imodel.saveChanges('fir all done');

        // I'm assuming this identifier is scoped to the root subject, but it's not; it's scoped to
        // the repository. I know it's unique though.

        const queryAspect = (
            "select Element.id, Version from only bis:ExternalSourceAspect"
            + " where Identifier='baaa404e-d7c6-46b4-b990-fbb8c2c530aa'"
        );

        const aspects: { 'element.id'? : bentley.Id64String, version?: string }[] = [];

        for await (const aspect of imodel.query(
            queryAspect, undefined,
            { rowFormat: common.QueryRowFormat.UseJsPropertyNames }
        )) {
            aspects.push(aspect);
        }

        assert.strictEqual(aspects.length, 1);

        assert.exists(aspects[0]['element.id']);
        const id = aspects[0]['element.id']!;

        assert.strictEqual(aspects[0].version, '1.0.1');

        const queryTile = (
            "select ECInstanceId, UserLabel, Condition from only TestConnector:SmallSquareTile"
            + ` where ECInstanceId=?`
        );

        const tiles: {id?: bentley.Id64String, userLabel?: string, condition?: string }[] = [];

        for await (const tile of imodel.query(
            queryTile, new common.QueryBinder().bindId(1, id!),
            {rowFormat: common.QueryRowFormat.UseJsPropertyNames }
        )) {
            tiles.push(tile);
        }

        assert.strictEqual(tiles.length, 1);

        assert.strictEqual(tiles[0].userLabel, "This is my favorite tile because it's tiny and square");
        assert.strictEqual(tiles[0].condition, 'Beautiful');
    });
});
