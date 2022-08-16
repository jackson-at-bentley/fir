/* eslint-disable @typescript-eslint/no-non-null-assertion */

import 'mocha';

import * as backend from '@itwin/core-backend';
import * as bentley from '@itwin/core-bentley';
import * as common from '@itwin/core-common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';

import {
    Aspect,
    Element,
    Meta,
    Model,
    Relationship,
    Repository,
    Source,
} from '../src/nodes.js';

import {
    Sync,
    toElement,
    toModel,
    toSource,
} from '../src/sync.js';

import { assert } from 'chai';
import { findElements } from '../src/queries.js';
import { nestedDefinitionModels } from './playthings.js';

const count = (imodel: backend.IModelDb, query: string, times: number): void => {
    imodel.withStatement<void>(query, (statement) => {
        statement.step();
        assert.strictEqual(statement.getValue(0).getInteger(), times);
    });
};

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
        bentley.Logger.initializeToConsole();
        bentley.Logger.setLevelDefault(bentley.LogLevel.Trace);
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

    it('sync and trim a toy imodel', () => {
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

        const partition: Element<common.InformationPartitionElementProps> = {
            classFullName: backend.LinkPartition.classFullName,
            code: common.Code.createEmpty(),
            model: 'repository',
            parent: 'root subject',
            meta: meta('partition', '1.0.0', repository, source),
            description: 'models my links',
            to: toElement,
        };

        const model: Model<common.ModelProps> = {
            classFullName: backend.LinkModel.classFullName,
            parentModel: 'repository',
            modeledElement: partition,
            to: toModel,
        };

        const nationalGeographic: Element<common.UrlLinkProps> = {
            classFullName: backend.UrlLink.classFullName,
            code: common.Code.createEmpty(),
            model,
            meta: meta('national geographic', '1.0.0', repository, source),
            description: 'the homepage of national geographic',
            url: 'https://nationalgeographic.com',
            to: toElement,
        };

        const nasa: Element<common.UrlLinkProps> = {
            classFullName: backend.UrlLink.classFullName,
            code: common.Code.createEmpty(),
            model,
            meta: meta('nasa', '1.0.0', repository, source),
            description: 'the homepage of nasa',
            url: 'https://www.nasa.gov/',
            to: toElement,
        };

        // TODO: How to test aspects?

        // Construct our synchronizer.

        let fir = new Sync(imodel);

        const putModel = fir.put.bind(fir);
        const putElement = fir.put.bind(fir);

        // Put the partition.

        const partitionId = putElement(partition);

        let foundPartition = imodel.elements.getElement<backend.LinkPartition>(partitionId);

        assert.strictEqual(foundPartition.description, 'models my links');

        const sources = findElements<common.ExternalSourceProps>(imodel, backend.ExternalSource.classFullName)
            .filter(source => source.connectorName === 'my first connector');

        assert.strictEqual(sources.length, 1);
        // const sourceId = sources[0].id;

        const repositories = findElements<common.RepositoryLinkProps>(imodel, backend.RepositoryLink.classFullName)
            .filter(link => link.url === 'github.com/iTwin');

        assert.strictEqual(repositories.length, 1);

        // const repositoryId = repositories[0].id;

        let  { aspectId } = fir.meta(partition);
        assert.exists(aspectId);
        let foundAspect = fir.imodel.elements.getAspect(aspectId!) as backend.ExternalSourceAspect;

        assert.strictEqual(foundAspect.version, '1.0.0');

        // Put the model.

        const modelId = putModel(model);

        let foundModel = imodel.models.getModel(modelId);

        assert.strictEqual(foundModel.className, 'LinkModel');

        // Sync the partition. Version change! o:

        partition.description = 'still models my links';
        partition.meta.version = '1.0.1';
        model.jsonProperties = { UserProps: { 'whitelist': 'developer.bentley.com' } };

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

        assert.deepStrictEqual(foundModel.jsonProperties, { 'UserProps': { 'whitelist': 'developer.bentley.com' } });

        ({ aspectId } = fir.meta(partition)); // Weird parse.
        assert.exists(aspectId);
        foundAspect = fir.imodel.elements.getAspect(aspectId!) as backend.ExternalSourceAspect;

        assert.strictEqual(foundAspect.version, '1.0.1');

        // Which elements have we seen?

        // assert.deepStrictEqual(fir.touched, new Set([ partitionId, sourceId, repositoryId ]));

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

        const deleted = fir.trim(partition);

        urls = findElements<common.UrlLinkProps>(imodel, backend.UrlLink.classFullName);
        assert.strictEqual(urls.length, 1);
        assert.strictEqual(urls[0].description, 'the homepage of national geographic');

        assert.strictEqual(deleted.deletedElements, 1);
        assert.strictEqual(deleted.deletedModels, 0);
        assert.strictEqual(deleted.deletedAspects, 1);
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
                aspects: [ channel ],
                to: toElement,
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

    it('put and delete relationship', () => {
        const fir = new Sync(imodel);

        const categoriesPartition: Element<common.InformationPartitionElementProps> = {
            classFullName: backend.DefinitionPartition.classFullName,
            model: 'repository',
            parent: 'root subject',
            code: common.Code.createEmpty(),
            meta: meta('categories partition', '1.0.0', 'root subject'),
            to: toElement,
        };

        fir.sync(categoriesPartition);

        const categories: Model<common.ModelProps> = {
            classFullName: backend.DefinitionModel.classFullName,
            modeledElement: categoriesPartition,
            parentModel: 'repository',
            to: toModel,
        };

        fir.sync(categories);

        const physicalPartition: Element<common.InformationPartitionElementProps> = {
            classFullName: backend.PhysicalPartition.classFullName,
            model: 'repository',
            parent: 'root subject',
            code: common.Code.createEmpty(),
            meta: meta('physical partition', '1.0.0', 'root subject'),
            to: toElement,
        };

        fir.sync(physicalPartition);

        const objects: Model<common.ModelProps> = {
            classFullName: backend.PhysicalModel.classFullName,
            modeledElement: physicalPartition,
            parentModel: 'repository',
            to: toModel,
        };

        fir.sync(objects);

        const drawingOfCircusTent: Element = {
            classFullName: 'generic:Document',
            model: 'repository',
            code: common.Code.createEmpty(),
            meta: meta('circus tent drawing', '1.0.0', 'root subject'),
            to: toElement,
        };

        fir.sync(drawingOfCircusTent);

        const categoryProps: Element<common.CategoryProps> = {
            ...backend.SpatialCategory.create(fir.imodel, fir.put(categories), 'category').toJSON(),
            model: categories,
            parent: undefined,
            meta: meta('drawings category', '1.0.0', categoriesPartition),
            to: toElement,
        };

        fir.sync(categoryProps);

        const circusTent: Element<common.PhysicalElementProps> = {
            classFullName: backend.PhysicalObject.classFullName,
            model: objects,
            code: common.Code.createEmpty(),
            meta: meta('circus tent', '1.0.0', physicalPartition),
            category: fir.put(categoryProps),
            userLabel: 'a circus tent',
            to: toElement,
        };

        const notCircusTent: Element<common.PhysicalElementProps> = {
            classFullName: backend.PhysicalObject.classFullName,
            model: objects,
            code: common.Code.createEmpty(),
            meta: meta('not a circus tent', '1.0.0', physicalPartition),
            category: fir.put(categoryProps),
            userLabel: 'not a circus tent',
            to: toElement,
        };

        fir.sync(circusTent);
        fir.sync(notCircusTent);

        // Finally, after that all that boilerplate to construct a valid iModel, let's insert a
        // relationship...

        // No type safety here, be careful you get the source and target correct! Everything is
        // narrowed to an element. The iTwin API doesn't to any better though.

        const ship: Relationship = {
            classFullName: 'bis:ElementRefersToDocuments',
            source: circusTent,
            target: drawingOfCircusTent,
            anchor: 'drawing to circus tent',
        };

        fir.put(ship);

        let foundShip = fir.imodel.relationships.tryGetInstanceProps(
            'bis:ElementRefersToDocuments',
            { sourceId: fir.put(circusTent), targetId: fir.put(drawingOfCircusTent) },
        );

        assert.exists(foundShip);
        assert.strictEqual(foundShip?.classFullName, 'BisCore:ElementRefersToDocuments');

        // ...and sync a relationship. Move the source.

        ship.source = notCircusTent;

        fir.put(ship);

        // There should still only be one link-table relationship.
        const ships = findElements<common.RelationshipProps>(imodel, 'BisCore:ElementRefersToDocuments');
        assert.strictEqual(ships.length, 1);

        foundShip = fir.imodel.relationships.tryGetInstanceProps(
            'bis:ElementRefersToDocuments',
            { sourceId: fir.put(notCircusTent), targetId: fir.put(drawingOfCircusTent) },
        );

        assert.exists(foundShip);

        const foundSource = fir.imodel.elements.tryGetElement(foundShip!.sourceId);

        assert.exists(foundSource);
        assert.strictEqual(foundSource!.userLabel, 'not a circus tent');

        // Test provenance clean-up.

        const pine = new Sync(imodel);

        const deleted = pine.trim(objects);

        assert.strictEqual(deleted.deletedElements, 2);
        assert.strictEqual(deleted.deletedModels, 0);
        assert.strictEqual(deleted.deletedAspects, 2);

        // To make sure the provenance for the relationship with anchor 'drawing to circus tent'
        // doesn't exist in fir's store anymore, we try to put the relationship again. If we
        // didn't clean up the provenance, we should hopefully encounter an error when fir finds
        // the stale provenance and the IDs no longer exist. I don't know if the backend will
        // just recycle them though.

        pine.put(ship);
    });

    it('link-table relationship cannot relate parent and child', () => {
        const fir = new Sync(imodel);

        const partition: Element<common.InformationPartitionElementProps> = {
            classFullName: backend.LinkPartition.classFullName,
            code: common.Code.createEmpty(),
            model: 'repository',
            parent: 'root subject',
            meta: meta('partition', '1.0.0', 'root subject'),
            to: toElement,
        };

        const model: Model<common.ModelProps> = {
            classFullName: backend.LinkModel.classFullName,
            modeledElement: partition,
            parentModel: 'repository',
            to: toModel,
        };

        const folder: Element<common.UrlLinkProps> = {
            classFullName: backend.FolderLink.classFullName,
            code: common.Code.createEmpty(),
            model,
            meta: meta('folder', '1.0.0', partition),
            to: toElement,
        };

        const url: Element<common.UrlLinkProps> = {
            classFullName: backend.UrlLink.classFullName,
            code: common.Code.createEmpty(),
            model,
            meta: meta('link', '1.0.0', partition),
            to: toElement,
        };

        fir.sync(folder), fir.sync(url);

        const folderOwnsUrl: Relationship = {
            classFullName: backend.ElementOwnsChildElements.classFullName,
            source: folder,
            target: url,
            anchor: 'folderOwnsUrl',
        };

        assert.throws(
            () => fir.put(folderOwnsUrl),
            /should be subclass of BisCore:ElementRefersToElements/i,
        );

        url.parent = folder;
        url.meta = meta('link', '1.0.0-parent', partition),

        // Navigation property okay though because iTwin API.

        fir.sync(url);

        // TODO: Why the period?
        const found: common.UrlLinkProps | undefined
            = findElements<common.UrlLinkProps>(fir.imodel, backend.UrlLink.classFullName)[0];

        assert.exists(found);
        assert.exists(found.parent);

        assert.strictEqual(found.parent!.id, fir.put(folder));
        assert.strictEqual(found.parent!.relClassName, 'BisCore.ElementOwnsChildElements');
    });

    it('elements cannot have the same external identifier', () => {
        const one: Element<common.UrlLinkProps> = {
            classFullName: backend.UrlLink.classFullName,
            code: common.Code.createEmpty(),
            model: 'repository',
            meta: meta('link', '1.0.0', 'root subject'),
            description: 'draft',
            to: toElement,
        };

        const two: Element<common.UrlLinkProps> = {
            classFullName: backend.UrlLink.classFullName,
            code: common.Code.createEmpty(),
            model: 'repository',
            meta: meta('link', '1.0.0', 'root subject'),
            description: 'napkin drawing',
            to: toElement,
        };

        const three: Element<common.UrlLinkProps> = {
            classFullName: backend.UrlLink.classFullName,
            code: common.Code.createEmpty(),
            model: 'repository',
            meta: meta('link', '1.0.0', 'root subject'),
            description: 'render',
            to: toElement,
        };

        const fir = new Sync(imodel);
        [ one, two, three ].forEach(fir.sync.bind(fir));

        const foundId = fir.meta(one).elementId;
        assert.exists(foundId);
        const found = fir.imodel.elements.getElementProps<common.UrlLinkProps>(foundId!);
        assert.strictEqual(found.description, 'draft');

        assert.strictEqual(
            findElements<common.UrlLinkProps>(fir.imodel, backend.UrlLink.classFullName).length,
            1
        );
    });

    it('trim nested definition models', () => {
        let fir = new Sync(imodel);

        // Write to the iModel!
        nestedDefinitionModels(fir);
        fir.imodel.saveChanges('fir all done');

        const query = (fullClass: string) => `select count(*) from ${fullClass}`;

        // Assert that the synchronizer inserted everything as intended.
        count(imodel, query(backend.Subject.classFullName), 2);             // +1 for root subject
        count(imodel, query(backend.DefinitionPartition.classFullName), 2); // +1 for dictionary partition
        count(imodel, query(backend.DefinitionModel.classFullName), 4);     // +1 for dictionary model, +1 for repository model
        count(imodel, query(backend.DefinitionContainer.classFullName), 2);
        count(imodel, query(backend.Category.classFullName), 2);

        // Okay, let's move this definition model to a different subject in the source file. We expect
        // everything to be deleted.

        fir = new Sync(imodel);

        const deleted = fir.trim('root subject');
        fir.imodel.saveChanges('fir all done');

        // Assert that the synchronizer correctly counted deleted iModel branches.
        assert.strictEqual(deleted.deletedElements, 8);
        assert.strictEqual(deleted.deletedModels, 2);
        assert.strictEqual(deleted.deletedAspects, 6);

        // Assert that the synchronizer cleaned up after itself.
        count(imodel, query(backend.Subject.classFullName), 1);             // +1 for root subject
        count(imodel, query(backend.DefinitionPartition.classFullName), 1); // +1 for dictionary partition
        count(imodel, query(backend.DefinitionModel.classFullName), 2);     // +1 for dictionary model, +1 for repository model
        count(imodel, query(backend.DefinitionContainer.classFullName), 0);
        count(imodel, query(backend.Category.classFullName), 0);
    });
});
