# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Wiki.js is a modern, lightweight wiki application built on Node.js. It's a full-stack JavaScript application using Vue.js 2 on the frontend and Node.js/Express on the backend, with GraphQL as the primary API layer.

## Build and Development Commands

### Development
```bash
npm run dev              # Start development server with hot module replacement
npm run watch            # Watch and rebuild client assets
```

### Production
```bash
npm run build            # Build production client assets (requires NODE_OPTIONS=--openssl-legacy-provider)
npm start                # Start production server
```

### Testing and Linting
```bash
npm test                 # Run ESLint on .js and .vue files, pug-lint on server views, and Jest tests
npm run cypress:open     # Open Cypress for E2E testing
```

**Note**: Build commands require `NODE_OPTIONS=--openssl-legacy-provider` due to OpenSSL 3.0 compatibility with older webpack/node versions.

## Architecture

### Server Architecture

The server follows a modular architecture with a clear boot sequence:

1. **Boot Sequence** (`server/index.js` → `server/core/kernel.js`)
   - Kernel initializes the global `WIKI` object
   - Database connection established via `server/core/db.js` using Knex.js and Objection.js ORM
   - Configuration loaded from database
   - Master process boots via `server/master.js`

2. **Global WIKI Object**
   - Central namespace for the entire application
   - Contains references to all core systems (auth, models, config, logger, etc.)
   - Accessible via `global.WIKI` throughout the codebase

3. **Core Systems** (`server/core/`)
   - `kernel.js` - Application lifecycle management
   - `db.js` - Database initialization and ORM setup with Knex/Objection
   - `auth.js` - Passport.js authentication system
   - `servers.js` - HTTP/HTTPS server management
   - `scheduler.js` - Job scheduling system
   - `config.js` - Configuration management
   - `localization.js` - i18next-based internationalization
   - `mail.js` - Email system
   - `telemetry.js` - Error tracking and telemetry

4. **Module System** (`server/modules/`)
   - Pluggable architecture for extensibility
   - Each module type has its own directory: `authentication/`, `storage/`, `rendering/`, `search/`, `analytics/`, `logging/`, `editor/`, `comments/`
   - Modules are defined by `definition.yml` files containing metadata and configuration schema
   - Loaded dynamically from disk on startup via `refreshXFromDisk()` methods
   - Module configs stored in database, merged with defaults from definition files

5. **Models** (`server/models/`)
   - Objection.js models extending `Model` class
   - Models auto-loaded from directory and attached to `WIKI.models`
   - Key models: `pages`, `users`, `groups`, `assets`, `authentication`, `storage`, etc.

6. **GraphQL API** (`server/graph/`)
   - Primary API layer using Apollo Server 2
   - Schema definitions in `schemas/` (`.graphql` files)
   - Resolvers in `resolvers/` organized by domain
   - Custom directives in `directives/`
   - Subscriptions via WebSocket for real-time updates (using `graphql-subscriptions` PubSub)

7. **Express Middleware Stack** (`server/master.js`)
   - Security middleware → CORS → Session (Knex-based) → Passport → GraphQL → View rendering → Error handling
   - Controllers in `server/controllers/` handle routes for auth, upload, common pages

### Client Architecture

1. **Vue.js 2 Application** (`client/`)
   - Entry points: `index-app.js` (main), `index-setup.js` (setup wizard), `index-legacy.js` (legacy browsers)
   - Webpack bundles: `app`, `setup`, `legacy`
   - Router-less architecture using dynamic component loading based on page state

2. **State Management**
   - Vuex store in `client/store/` with `vuex-pathify` for simplified state access
   - `vuex-persistedstate` for localStorage persistence

3. **Apollo Client** (`client/client-app.js`)
   - BatchHttpLink for GraphQL queries/mutations
   - WebSocketLink for subscriptions
   - JWT authentication via cookies, auto-renewal via response headers

4. **UI Framework**
   - Vuetify 2.x for Material Design components
   - Theme system in `client/themes/` (currently supports `default` theme)
   - Components organized in `client/components/`: `admin/`, `editor/`, `common/`

5. **Build System** (`dev/webpack/`)
   - Webpack 4 configuration
   - Separate dev (`webpack.dev.js`) and production (`webpack.prod.js`) configs
   - Hot Module Replacement in development
   - Code splitting with dynamic imports and webpackChunkName comments

### Database

- **ORM**: Knex.js (query builder) + Objection.js (ORM)
- **Supported Databases**: PostgreSQL, MySQL/MariaDB, MSSQL, SQLite
- **Migrations**: Located in `server/db/migrations/`, custom migrationSource in `server/db/migrator-source.js`
- **High Availability**: PostgreSQL LISTEN/NOTIFY for multi-instance pub/sub (when `ha` config enabled)
- **Schema**: PostgreSQL schema support via `search_path` configuration

### Key Patterns

1. **Module Loading**
   - `auto-load` package used to recursively require directories
   - Module definitions loaded from YAML (`js-yaml`)
   - Module props parsed via `commonHelper.parseModuleProps()`

2. **Authentication Strategy Pattern**
   - Each strategy in `server/modules/authentication/{strategy}/`
   - Contains `definition.yml` and `authentication.js`
   - Strategies registered with Passport.js dynamically
   - Strategy activation via `WIKI.auth.activateStrategies()`

3. **Storage Target Pattern**
   - Similar to auth strategies, in `server/modules/storage/{target}/`
   - Multiple storage targets can be active simultaneously
   - Sync jobs managed by scheduler

4. **Page Rendering Pipeline**
   - Renderers in `server/modules/rendering/{renderer}/`
   - Markdown → HTML conversion with plugins (markdown-it based)
   - Support for diagrams (mermaid, PlantUML), math (KaTeX), code highlighting (Prism.js)

5. **Search Engine Integration**
   - Search engines in `server/modules/search/{engine}/`
   - Elasticsearch (v6, v7, v8), Algolia, Azure Search, Solr, PostgreSQL full-text, etc.
   - Single active search engine, initialized on boot

## Configuration

- **Main Config**: `config.yml` in root (not committed by default, use `config.sample.yml` as template)
- **Database Config**: Can use `config.yml` or `DATABASE_URL` environment variable
- **SSL**: Configurable via `config.ssl`, supports Let's Encrypt ACME
- **Session**: Secret must be set in `config.sessionSecret`

## Important Development Notes

1. **Global Object Pattern**: Almost everything is accessed via the global `WIKI` object, not through imports
2. **Async Initialization**: The boot sequence is heavily async - always check `WIKI.models.onReady` promise
3. **Module Hot-Reloading**: Modules are refreshed from disk on startup, not dynamically in production
4. **GraphQL Schema**: Schema files are `.graphql` and loaded from `server/graph/schemas/`
5. **Vue Components**: Use lazy loading with dynamic imports and webpack magic comments for code splitting
6. **Database Transactions**: Use Knex transaction support via `WIKI.models.knex.transaction()`
7. **Logging**: Winston logger available at `WIKI.logger` with custom transport for live admin trail
8. **Testing**: Jest configured for unit tests, Cypress for E2E tests

## File Structure Conventions

- `server/` - All backend code
  - `core/` - Core system modules
  - `models/` - Objection.js ORM models
  - `modules/` - Pluggable modules (auth, storage, etc.)
  - `graph/` - GraphQL schemas, resolvers, directives
  - `controllers/` - Express route controllers
  - `helpers/` - Utility functions
  - `middlewares/` - Express middlewares
  - `db/` - Database migrations and utilities
- `client/` - All frontend code
  - `components/` - Vue.js components
  - `store/` - Vuex store modules
  - `graph/` - GraphQL queries/mutations
  - `themes/` - Theme-specific components
  - `scss/` - Global styles
- `dev/` - Development tools and webpack configs
- `assets/` - Compiled client assets (generated, not committed)

## Common Workflows

### Adding a New Authentication Strategy
1. Create directory in `server/modules/authentication/{key}/`
2. Add `definition.yml` with metadata and props schema
3. Add `authentication.js` with Passport strategy implementation
4. Strategy auto-discovered on next server restart

### Adding a New Model
1. Create file in `server/models/{model}.js`
2. Extend Objection `Model` class
3. Define `tableName`, `jsonSchema`, and relationships
4. Model auto-loaded and available at `WIKI.models.{model}`

### Adding a New GraphQL Query/Mutation
1. Define type in `server/graph/schemas/{domain}.graphql`
2. Add resolver in `server/graph/resolvers/{domain}.js`
3. Restart server to reload schema

### Working with Database Migrations
- Create migration: Manually add file to `server/db/migrations/`
- Migrations run automatically on server start
- Use Knex schema builder syntax
