/* eslint-disable @typescript-eslint/no-non-null-assertion */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';

import 'mocha';
import { assert } from 'chai';

import * as backend from '@itwin/core-backend';
import * as common from '@itwin/core-common';

import { Element, Model, Meta, Source, Repository, Aspect } from '../src/nodes.js';
import { Sync, toModel, toElement, toSource } from '../src/sync.js';
import { findElements } from '../src/queries.js';

describe('sync', () => {
    const name = 'my-first-imodel';
    const root = path.dirname(url.fileURLToPath(import.meta.url));
    const outputPath = path.join(root, '..', 'side-effects');
    const imodelPath = path.join(outputPath, `${name}.bim`);
    let imodel: backend.SnapshotDb;

    before(async () => {
        const configuration = new backend.IModelHostConfiguration();
        configuration.cacheDir = outputPath;
        await backend.IModelHost.startup(configuration);
    });

    after(async () => {
        await backend.IModelHost.shutdown();
    });

    beforeEach(() => {
        imodel = backend.SnapshotDb.createEmpty(imodelPath, {
            name,
            rootSubject: { name: 'root' }
        });
    });

    afterEach(() => {
        imodel.close();
        fs.rmSync(imodelPath, { maxRetries: 2, retryDelay: 2 * 1000 });
    });

    type Plaything = {
        partition: Element<common.InformationPartitionElementProps>,
        model: Model<common.ModelProps>,
        nationalGeographic: Element<common.UrlLinkProps>,
        nasa: Element<common.UrlLinkProps>,
    };

    function meta<E extends Element>(anchor: string, version: string, scope: E, source?: Source): Meta {
        return {
            classFullName: backend.ExternalSourceAspect.classFullName,
            scope,
            source,
            anchor,
            kind: 'json',
            version,
        };
    }

    function plaything(): Plaything {
        const repository: Repository = {
            classFullName: backend.RepositoryLink.classFullName,
            code: common.Code.createEmpty(),
            model: 'repository',
            meta: meta('repository', '1.0.0', 'root subject'),
            url: 'github.com/iTwin',
            to: toElement,
        };

        const source: Source = {
            classFullName: backend.ExternalSource.classFullName,
            code: common.Code.createEmpty(),
            model: 'repository',
            meta: meta('source', '1.0.0', 'root subject'),
            connectorName: 'my first connector',
            connectorVersion: '1.0.0',
            repository,
            to: toSource,
        };

        const linkPartition: Element<common.InformationPartitionElementProps> = {
            classFullName: backend.LinkPartition.classFullName,
            code: common.Code.createEmpty(),
            model: 'repository',
            parent: 'root subject',
            meta: meta('partition', '1.0.0', repository, source),
            description: 'models my links',
            to: toElement,
        };

        const linkModel: Model<common.ModelProps> = {
            classFullName: backend.LinkModel.classFullName,
            parentModel: 'repository',
            modeledElement: linkPartition,
            to: toModel,
        };

        const nationalGeographic: Element<common.UrlLinkProps> = {
            classFullName: backend.UrlLink.classFullName,
            code: common.Code.createEmpty(),
            model: linkModel,
            meta: meta('national geographic', '1.0.0', repository, source),
            description: 'the homepage of national geographic',
            url: 'https://nationalgeographic.com',
            to: toElement,
        };

        const nasa: Element<common.UrlLinkProps> = {
            classFullName: backend.UrlLink.classFullName,
            code: common.Code.createEmpty(),
            model: linkModel,
            meta: meta('nasa', '1.0.0', repository, source),
            description: 'the homepage of nasa',
            url: 'https://www.nasa.gov/',
            to: toElement,
        };

        return {
            partition: linkPartition,
            model: linkModel,
            nationalGeographic,
            nasa,
        };
    }

    it('sync and trim a toy imodel', () => {
        // TODO: How to test aspects?

        // Construct our synchronizer.

        let fir = new Sync(imodel);

        const putModel = fir.put.bind(fir);
        const putElement = fir.put.bind(fir);

        const { partition, model, nationalGeographic, nasa } = plaything();

        // Put the partition.

        const partitionId = putElement(partition);

        let foundPartition = imodel.elements.getElement<backend.LinkPartition>(partitionId);

        assert.strictEqual(foundPartition.description, 'models my links');

        const sources = findElements<common.ExternalSourceProps>(imodel, backend.ExternalSource.classFullName)
            .filter(source => source.connectorName === 'my first connector');

        assert.strictEqual(sources.length, 1);
        const sourceId = sources[0].id;

        const repositories = findElements<common.RepositoryLinkProps>(imodel, backend.RepositoryLink.classFullName)
            .filter(link => link.url === 'github.com/iTwin');

        assert.strictEqual(repositories.length, 1);

        const repositoryId = repositories[0].id;

        let aspectId = fir.getExternalAspect(partition).aspectId;
        assert.exists(aspectId);
        let foundAspect = fir.imodel.elements.getAspect(aspectId!) as backend.ExternalSourceAspect;

        assert.strictEqual(foundAspect.version, "1.0.0");

        // Put the model.

        const modelId = putModel(model);

        let foundModel = imodel.models.getModel(modelId);

        assert.strictEqual(foundModel.className, 'LinkModel');

        // Sync the partition. Version change! o:

        if (partition === 'root subject' || model === 'repository') {
            assert.fail('what on earth did you do');
        }

        partition.description = 'still models my links';
        partition.meta.version = `1.0.1`;
        model.jsonProperties = { "whitelist": "developer.bentley.com" };

        // Model must be synced first. A model does not have an external source aspect because it
        // is not an element, so it relies on detecting a change in the modeled element to know
        // when it should update. If the modeled element is synced first, no change will be detected.
        // Think of syncing as reconciling the difference between the in-memory representation and
        // the iModel.

        fir.sync(model);

        fir.sync(partition);

        foundPartition = imodel.elements.getElement<backend.LinkPartition>(partitionId);
        foundModel = imodel.models.getModel(modelId);

        assert.strictEqual(foundPartition.description, 'still models my links');

        assert.deepStrictEqual(foundModel.jsonProperties, { "whitelist": "developer.bentley.com" });

        aspectId = fir.getExternalAspect(partition).aspectId;
        assert.exists(aspectId);
        foundAspect = fir.imodel.elements.getAspect(aspectId!) as backend.ExternalSourceAspect;

        assert.strictEqual(foundAspect.version, "1.0.1");

        // Which elements have we seen?

        assert.deepStrictEqual(fir.touched, new Set([ partitionId, sourceId, repositoryId ]));

        // Okay now let's sync some URLs...

        fir.sync(nationalGeographic);
        fir.sync(nasa);

        let urls = findElements<common.UrlLinkProps>(imodel, backend.UrlLink.classFullName);
        assert.strictEqual(urls.length, 2);

        // ...and start a new run, forgetting everything we've visited. This time, sync only Nat
        // Geo. This will also insert the partition, source, and repository, because the URL link
        // refers indirectly to all of these elements.

        fir = new Sync(imodel);
        fir.sync(nationalGeographic);

        // Now trim the fir and see what happens.

        fir.trim(partition); // TODO: This API needs to change, don't take an ID.

        urls = findElements<common.UrlLinkProps>(imodel, backend.UrlLink.classFullName);
        assert.strictEqual(urls.length, 1);
        assert.strictEqual(urls[0].description, 'the homepage of national geographic');
    });

    it('can sync unique aspects', () => {
        const fir = new Sync(imodel);

        // Let's attach a unique aspect to this partition.

        const partition = (owner: string, version: string): Element<common.InformationPartitionElementProps> => {
            const channel: Aspect<common.ChannelRootAspectProps> = {
                classFullName: backend.ChannelRootAspect.classFullName,
                owner,
            };

            return {
                classFullName: backend.LinkPartition.classFullName,
                model: 'repository',
                parent: 'root subject',
                code: common.Code.createEmpty(),
                meta: {
                    classFullName: backend.ExternalSourceAspect.classFullName,
                    scope: 'root subject',
                    anchor: 'links',
                    kind: 'json',
                    version,
                },
                to: toElement,
                aspects: [ channel ]
            };
        };

        fir.sync(partition('Winston', '1.0.0-night-circus'));

        let uniques = findElements<common.ChannelRootAspectProps>(
            imodel, backend.ChannelRootAspect.classFullName
        );

        assert.strictEqual(uniques.length, 1);
        assert.strictEqual(uniques[0].owner, 'Winston');

        // Now let's see if the library properly updates unique aspects.

        fir.sync(partition('Penelope', '2.0.0-starless-sea'));

        uniques = findElements<common.ChannelRootAspectProps>(
            imodel, backend.ChannelRootAspect.classFullName
        );

        assert.strictEqual(uniques.length, 1);
        assert.strictEqual(uniques[0].owner, 'Penelope');
    });
});
