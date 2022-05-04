--- Archipelago SQL schema rollup
--- Generated: 2022-05-04T05:42:16.539Z
--- Scope: 88 migrations, through 0088_traits_value_text

--
-- PostgreSQL database dump
--

-- Dumped from database version 12.9 (Ubuntu 12.9-2.pgdg20.04+1)
-- Dumped by pg_dump version 12.8 (Ubuntu 12.8-1.pgdg20.04+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: address; Type: DOMAIN; Schema: public; Owner: -
--

CREATE DOMAIN public.address AS bytea
	CONSTRAINT address_length CHECK ((octet_length(VALUE) = 20));


--
-- Name: askid; Type: DOMAIN; Schema: public; Owner: -
--

CREATE DOMAIN public.askid AS bigint
	CONSTRAINT askid_type CHECK ((((VALUE >> 58) & (63)::bigint) = 7));


--
-- Name: bidid; Type: DOMAIN; Schema: public; Owner: -
--

CREATE DOMAIN public.bidid AS bigint
	CONSTRAINT bidid_type CHECK ((((VALUE >> 58) & (63)::bigint) = 6));


--
-- Name: bytes32; Type: DOMAIN; Schema: public; Owner: -
--

CREATE DOMAIN public.bytes32 AS bytea
	CONSTRAINT bytes32_length CHECK ((octet_length(VALUE) = 32));


--
-- Name: currencyid; Type: DOMAIN; Schema: public; Owner: -
--

CREATE DOMAIN public.currencyid AS bigint
	CONSTRAINT currencyid_type CHECK ((((VALUE >> 58) & (63)::bigint) = 5));


--
-- Name: featureid; Type: DOMAIN; Schema: public; Owner: -
--

CREATE DOMAIN public.featureid AS bigint
	CONSTRAINT featureid_type CHECK ((((VALUE >> 58) & (63)::bigint) = 3));


--
-- Name: opensea_event_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.opensea_event_type AS ENUM (
    'created',
    'successful',
    'cancelled',
    'bid_entered',
    'bid_withdrawn',
    'transfer',
    'approve'
);


--
-- Name: projectid; Type: DOMAIN; Schema: public; Owner: -
--

CREATE DOMAIN public.projectid AS bigint
	CONSTRAINT projectid_type CHECK ((((VALUE >> 58) & (63)::bigint) = 2));


--
-- Name: signature; Type: DOMAIN; Schema: public; Owner: -
--

CREATE DOMAIN public.signature AS bytea
	CONSTRAINT signature_length CHECK ((octet_length(VALUE) = 65));


--
-- Name: tokenid; Type: DOMAIN; Schema: public; Owner: -
--

CREATE DOMAIN public.tokenid AS bigint
	CONSTRAINT tokenid_type CHECK ((((VALUE >> 58) & (63)::bigint) = 1));


--
-- Name: traitid; Type: DOMAIN; Schema: public; Owner: -
--

CREATE DOMAIN public.traitid AS bigint
	CONSTRAINT traitid_type CHECK ((((VALUE >> 58) & (63)::bigint) = 4));


--
-- Name: uint256; Type: DOMAIN; Schema: public; Owner: -
--

CREATE DOMAIN public.uint256 AS numeric(78,0)
	CONSTRAINT uint256_nonnegative CHECK ((VALUE >= (0)::numeric))
	CONSTRAINT uint256_range CHECK ((VALUE < '115792089237316195423570985008687907853269984665640564039457584007913129639936'::numeric));


--
-- Name: hexaddr(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.hexaddr(zero_x_address text) RETURNS public.address
    LANGUAGE sql IMMUTABLE STRICT
    AS $_$
      SELECT overlay($1 placing '\' from 1 for 1)::bytea::address
    $_$;


--
-- Name: hexbytes(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.hexbytes(zero_x_string text) RETURNS bytea
    LANGUAGE sql IMMUTABLE STRICT
    AS $_$
      SELECT overlay($1 placing '\' from 1 for 1)::bytea
    $_$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: artblocks_projects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.artblocks_projects (
    project_id public.projectid NOT NULL,
    artblocks_project_index integer NOT NULL
);


--
-- Name: currencies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.currencies (
    currency_id public.currencyid NOT NULL,
    address public.address NOT NULL,
    symbol text NOT NULL,
    name text NOT NULL,
    decimals integer
);


--
-- Name: email_signups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_signups (
    email text NOT NULL,
    create_time timestamp with time zone
);


--
-- Name: erc_721_transfer_scan_progress; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.erc_721_transfer_scan_progress (
    contract_address public.address NOT NULL,
    fetch_time timestamp with time zone NOT NULL,
    block_number integer NOT NULL,
    block_hash text NOT NULL
);


--
-- Name: erc_721_transfers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.erc_721_transfers (
    token_id public.tokenid NOT NULL,
    transaction_hash text NOT NULL,
    from_address public.address NOT NULL,
    to_address public.address NOT NULL,
    block_number integer NOT NULL,
    block_hash public.bytes32 NOT NULL,
    log_index integer NOT NULL
);


--
-- Name: erc_721_transfers_deferred; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.erc_721_transfers_deferred (
    token_contract public.address NOT NULL,
    on_chain_token_id public.uint256 NOT NULL,
    log_object jsonb NOT NULL
);


--
-- Name: eth_blocks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.eth_blocks (
    block_hash public.bytes32 NOT NULL,
    block_number integer NOT NULL,
    "timestamp" timestamp with time zone NOT NULL
);


--
-- Name: features; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.features (
    feature_id public.featureid NOT NULL,
    project_id public.projectid,
    name text NOT NULL
);


--
-- Name: image_progress; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.image_progress (
    project_id public.projectid NOT NULL,
    completed_through_token_index integer
);


--
-- Name: migration_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.migration_log (
    migration_id bigint NOT NULL,
    name text NOT NULL,
    "timestamp" timestamp with time zone NOT NULL,
    blob_hash bytea NOT NULL,
    CONSTRAINT migration_log_blob_hash_check CHECK ((octet_length(blob_hash) = 20))
);


--
-- Name: opensea_ask_cancellations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.opensea_ask_cancellations (
    event_id text NOT NULL,
    project_id public.projectid NOT NULL,
    token_id public.tokenid NOT NULL,
    transaction_timestamp timestamp with time zone NOT NULL,
    transaction_hash text NOT NULL,
    listing_time timestamp with time zone NOT NULL
);


--
-- Name: opensea_asks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.opensea_asks (
    event_id text NOT NULL,
    project_id public.projectid NOT NULL,
    token_id public.tokenid NOT NULL,
    seller_address public.address NOT NULL,
    listing_time timestamp with time zone NOT NULL,
    expiration_time timestamp with time zone,
    price public.uint256 NOT NULL,
    currency_id public.currencyid NOT NULL,
    active boolean NOT NULL
);


--
-- Name: opensea_events_ingestion_deferred; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.opensea_events_ingestion_deferred (
    event_id text NOT NULL,
    event_type public.opensea_event_type NOT NULL,
    token_contract public.address NOT NULL,
    on_chain_token_id public.uint256 NOT NULL
);


--
-- Name: opensea_events_ingestion_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.opensea_events_ingestion_queue (
    event_id text NOT NULL,
    event_type public.opensea_event_type NOT NULL
);


--
-- Name: opensea_events_raw; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.opensea_events_raw (
    event_id text NOT NULL,
    json jsonb NOT NULL
);


--
-- Name: opensea_progress; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.opensea_progress (
    opensea_slug text NOT NULL,
    until timestamp with time zone NOT NULL,
    project_id public.projectid NOT NULL
);


--
-- Name: opensea_sales; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.opensea_sales (
    event_id text NOT NULL,
    project_id public.projectid NOT NULL,
    token_id public.tokenid NOT NULL,
    seller_address public.address NOT NULL,
    buyer_address public.address NOT NULL,
    transaction_timestamp timestamp with time zone NOT NULL,
    transaction_hash text NOT NULL,
    listing_time timestamp with time zone,
    price public.uint256 NOT NULL,
    currency_id public.currencyid NOT NULL
);


--
-- Name: projects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.projects (
    project_id public.projectid NOT NULL,
    name text NOT NULL,
    max_invocations integer NOT NULL,
    artist_name text,
    description text,
    script_json jsonb,
    aspect_ratio double precision,
    num_tokens integer NOT NULL,
    slug text,
    script text,
    token_contract public.address NOT NULL
);


--
-- Name: tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tokens (
    token_id public.tokenid NOT NULL,
    fetch_time timestamp with time zone NOT NULL,
    token_data json,
    project_id public.projectid NOT NULL,
    token_contract public.address NOT NULL,
    on_chain_token_id public.uint256 NOT NULL,
    token_index integer NOT NULL
);


--
-- Name: trait_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trait_members (
    trait_id public.traitid NOT NULL,
    token_id public.tokenid NOT NULL
);


--
-- Name: traits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.traits (
    trait_id public.traitid NOT NULL,
    feature_id public.featureid NOT NULL,
    value text NOT NULL
);


--
-- Data for Name: artblocks_projects; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: currencies; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.currencies VALUES (1535410341709086720, '\x0000000000000000000000000000000000000000', 'ETH', 'Ether', 18);
INSERT INTO public.currencies VALUES (1540312924849438721, '\xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', 'WETH', 'Wrapped Ether', 18);
INSERT INTO public.currencies VALUES (1541639835452702722, '\xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', 'USDC', 'USD Coin', 6);
INSERT INTO public.currencies VALUES (1544284093318430723, '\x6b175474e89094c44da98b954eedeac495271d0f', 'DAI', 'Dai Stablecoin', 18);


--
-- Data for Name: email_signups; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: erc_721_transfer_scan_progress; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: erc_721_transfers; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: erc_721_transfers_deferred; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: eth_blocks; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: features; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: image_progress; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: migration_log; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.migration_log VALUES (484254776263135182, '0076_migration_log', '2001-01-01 00:00:01+00', '\x89b198ebdeb9688d7e2de5095fcb1f57a3436a06');
INSERT INTO public.migration_log VALUES (956792697637953902, '0077_bytes32', '2001-01-01 00:00:02+00', '\x6286c706654028706d39ae1a2dc8f1c3cd62eb64');
INSERT INTO public.migration_log VALUES (351408350089178552, '0078_hexbytes', '2001-01-01 00:00:03+00', '\xc871f55646d1c4ec105e7ffc761f03e4e80d9892');
INSERT INTO public.migration_log VALUES (338376316163052028, '0079_eth_blocks', '2001-01-01 00:00:04+00', '\x15598a9826bdd0dc24f4294e17ad0ef090695a14');
INSERT INTO public.migration_log VALUES (1077153230057093442, '0080_transfers_block_hash_bytes', '2001-01-01 00:00:05+00', '\xbbdf3a24c2cda8f2bd16cf44a43ec0022a763140');
INSERT INTO public.migration_log VALUES (1044672390517680347, '0081_transfers_block_hash_nullable', '2001-01-01 00:00:06+00', '\x42f4fc8db89dee7ee4bfeac303fdf037f537e75c');
INSERT INTO public.migration_log VALUES (544977996675729576, '0082_transfers_block_hash_bytes32', '2001-01-01 00:00:07+00', '\xe1f8785d6eb8e0a3dda2c69bb0cdf0f6cfdc7f81');
INSERT INTO public.migration_log VALUES (199886966959710743, '0083_transfers_block_hash_bytes_nullable', '2001-01-01 00:00:08+00', '\x2f2293ed1ae934e7884282802e486a90dea5e9c9');
INSERT INTO public.migration_log VALUES (114140175342751440, '0084_transfers_drop_block_hash_bytes', '2001-01-01 00:00:09+00', '\x1fda15a8569b028c67bf29fb4d5c3dac08795645');
INSERT INTO public.migration_log VALUES (334477765055357002, '0085_signature_type', '2001-01-01 00:00:10+00', '\xa54f764abd66c54322e78ff75371693842f53193');
INSERT INTO public.migration_log VALUES (359305773092484221, '0086_index_erc_721_transfers_hom', '2001-01-01 00:00:11+00', '\xc42fda5150dfd4a5600a767caf5f638cc369d715');
INSERT INTO public.migration_log VALUES (483324709114861553, '0087_traits_value_json_text', '2001-01-01 00:00:12+00', '\x3c3a424930ac57be0d529fc64091bb8b89eb3c1d');
INSERT INTO public.migration_log VALUES (287590692049242308, '0088_traits_value_text', '2001-01-01 00:00:13+00', '\x61d6a8b4031ed225d34e4e888220f75e62fcfed2');


--
-- Data for Name: opensea_ask_cancellations; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: opensea_asks; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: opensea_events_ingestion_deferred; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: opensea_events_ingestion_queue; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: opensea_events_raw; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: opensea_progress; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: opensea_sales; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: projects; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: tokens; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: trait_members; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: traits; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Name: artblocks_projects artblocks_projects_artblocks_project_index_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artblocks_projects
    ADD CONSTRAINT artblocks_projects_artblocks_project_index_key UNIQUE (artblocks_project_index);


--
-- Name: artblocks_projects artblocks_projects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artblocks_projects
    ADD CONSTRAINT artblocks_projects_pkey PRIMARY KEY (project_id);


--
-- Name: currencies currencies_address_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.currencies
    ADD CONSTRAINT currencies_address_key UNIQUE (address);


--
-- Name: currencies currencies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.currencies
    ADD CONSTRAINT currencies_pkey PRIMARY KEY (currency_id);


--
-- Name: email_signups email_signups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_signups
    ADD CONSTRAINT email_signups_pkey PRIMARY KEY (email);


--
-- Name: erc_721_transfer_scan_progress erc_721_transfer_scan_progres_contract_address_block_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.erc_721_transfer_scan_progress
    ADD CONSTRAINT erc_721_transfer_scan_progres_contract_address_block_number_key UNIQUE (contract_address, block_number);


--
-- Name: erc_721_transfer_scan_progress erc_721_transfer_scan_progress_contract_address_block_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.erc_721_transfer_scan_progress
    ADD CONSTRAINT erc_721_transfer_scan_progress_contract_address_block_hash_key UNIQUE (contract_address, block_hash);


--
-- Name: erc_721_transfers erc_721_transfers_block_hash_log_index_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.erc_721_transfers
    ADD CONSTRAINT erc_721_transfers_block_hash_log_index_key UNIQUE (block_hash, log_index);


--
-- Name: eth_blocks eth_blocks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eth_blocks
    ADD CONSTRAINT eth_blocks_pkey PRIMARY KEY (block_hash);


--
-- Name: features features_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.features
    ADD CONSTRAINT features_pkey PRIMARY KEY (feature_id);


--
-- Name: features features_project_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.features
    ADD CONSTRAINT features_project_id_name_key UNIQUE (project_id, name);


--
-- Name: image_progress image_progress_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.image_progress
    ADD CONSTRAINT image_progress_pkey PRIMARY KEY (project_id);


--
-- Name: migration_log migration_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.migration_log
    ADD CONSTRAINT migration_log_pkey PRIMARY KEY (migration_id);


--
-- Name: opensea_ask_cancellations opensea_ask_cancellations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opensea_ask_cancellations
    ADD CONSTRAINT opensea_ask_cancellations_pkey PRIMARY KEY (event_id);


--
-- Name: opensea_asks opensea_asks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opensea_asks
    ADD CONSTRAINT opensea_asks_pkey PRIMARY KEY (event_id);


--
-- Name: opensea_events_ingestion_deferred opensea_events_ingestion_deferred_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opensea_events_ingestion_deferred
    ADD CONSTRAINT opensea_events_ingestion_deferred_pkey PRIMARY KEY (event_id);


--
-- Name: opensea_events_ingestion_queue opensea_events_ingestion_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opensea_events_ingestion_queue
    ADD CONSTRAINT opensea_events_ingestion_queue_pkey PRIMARY KEY (event_id);


--
-- Name: opensea_events_raw opensea_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opensea_events_raw
    ADD CONSTRAINT opensea_events_pkey PRIMARY KEY (event_id);


--
-- Name: opensea_progress opensea_progress_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opensea_progress
    ADD CONSTRAINT opensea_progress_pkey PRIMARY KEY (project_id);


--
-- Name: opensea_sales opensea_sales_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opensea_sales
    ADD CONSTRAINT opensea_sales_pkey PRIMARY KEY (event_id);


--
-- Name: projects projects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_pkey PRIMARY KEY (project_id);


--
-- Name: projects projects_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_slug_key UNIQUE (slug);


--
-- Name: tokens tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tokens
    ADD CONSTRAINT tokens_pkey PRIMARY KEY (token_id);


--
-- Name: trait_members trait_members_trait_id_token_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trait_members
    ADD CONSTRAINT trait_members_trait_id_token_id_key UNIQUE (trait_id, token_id);


--
-- Name: traits traits_feature_id_value_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.traits
    ADD CONSTRAINT traits_feature_id_value_key UNIQUE (feature_id, value);


--
-- Name: traits traits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.traits
    ADD CONSTRAINT traits_pkey PRIMARY KEY (trait_id);


--
-- Name: erc_721_transfer_scan_progress_contract_address_block_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX erc_721_transfer_scan_progress_contract_address_block_number ON public.erc_721_transfer_scan_progress USING btree (contract_address, block_number DESC);


--
-- Name: erc_721_transfers_deferred_token_contract_on_chain_token_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX erc_721_transfers_deferred_token_contract_on_chain_token_id_idx ON public.erc_721_transfers_deferred USING btree (token_contract, on_chain_token_id, ((log_object ->> 'blockHash'::text)), ((log_object ->> 'logIndex'::text)));


--
-- Name: erc_721_transfers_from_address_to_address; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX erc_721_transfers_from_address_to_address ON public.erc_721_transfers USING btree (from_address, to_address);


--
-- Name: erc_721_transfers_token_id_block_number_log_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX erc_721_transfers_token_id_block_number_log_index ON public.erc_721_transfers USING btree (token_id, block_number DESC, log_index DESC);


--
-- Name: opensea_ask_cancellations_token_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX opensea_ask_cancellations_token_id ON public.opensea_ask_cancellations USING btree (token_id);


--
-- Name: opensea_asks_active_currency_id_project_id_price; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX opensea_asks_active_currency_id_project_id_price ON public.opensea_asks USING btree (active, currency_id, project_id, price);


--
-- Name: opensea_asks_active_currency_id_project_id_token_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX opensea_asks_active_currency_id_project_id_token_id ON public.opensea_asks USING btree (active, currency_id, project_id, token_id) INCLUDE (price);


--
-- Name: opensea_asks_expiration_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX opensea_asks_expiration_time ON public.opensea_asks USING btree (expiration_time) WHERE active;


--
-- Name: opensea_asks_token_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX opensea_asks_token_id ON public.opensea_asks USING btree (token_id);


--
-- Name: opensea_sales_project_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX opensea_sales_project_id_idx ON public.opensea_sales USING btree (project_id);


--
-- Name: opensea_sales_token_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX opensea_sales_token_id ON public.opensea_sales USING btree (token_id);


--
-- Name: projects_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX projects_slug ON public.projects USING btree (slug);


--
-- Name: tokens_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tokens_project_id ON public.tokens USING btree (project_id);


--
-- Name: tokens_project_id_token_index; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tokens_project_id_token_index ON public.tokens USING btree (project_id, token_index);


--
-- Name: tokens_token_contract_on_chain_token_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tokens_token_contract_on_chain_token_id ON public.tokens USING btree (token_contract, on_chain_token_id);


--
-- Name: trait_members_token_id_trait_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trait_members_token_id_trait_id ON public.trait_members USING btree (token_id, trait_id);


--
-- Name: artblocks_projects artblocks_projects_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artblocks_projects
    ADD CONSTRAINT artblocks_projects_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(project_id);


--
-- Name: erc_721_transfers erc_721_transfers_token_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.erc_721_transfers
    ADD CONSTRAINT erc_721_transfers_token_id_fkey FOREIGN KEY (token_id) REFERENCES public.tokens(token_id);


--
-- Name: features features_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.features
    ADD CONSTRAINT features_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(project_id);


--
-- Name: image_progress image_progress_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.image_progress
    ADD CONSTRAINT image_progress_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(project_id);


--
-- Name: opensea_ask_cancellations opensea_ask_cancellations_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opensea_ask_cancellations
    ADD CONSTRAINT opensea_ask_cancellations_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.opensea_events_raw(event_id);


--
-- Name: opensea_ask_cancellations opensea_ask_cancellations_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opensea_ask_cancellations
    ADD CONSTRAINT opensea_ask_cancellations_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(project_id);


--
-- Name: opensea_ask_cancellations opensea_ask_cancellations_token_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opensea_ask_cancellations
    ADD CONSTRAINT opensea_ask_cancellations_token_id_fkey FOREIGN KEY (token_id) REFERENCES public.tokens(token_id);


--
-- Name: opensea_asks opensea_asks_currency_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opensea_asks
    ADD CONSTRAINT opensea_asks_currency_id_fkey FOREIGN KEY (currency_id) REFERENCES public.currencies(currency_id);


--
-- Name: opensea_asks opensea_asks_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opensea_asks
    ADD CONSTRAINT opensea_asks_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.opensea_events_raw(event_id);


--
-- Name: opensea_asks opensea_asks_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opensea_asks
    ADD CONSTRAINT opensea_asks_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(project_id);


--
-- Name: opensea_asks opensea_asks_token_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opensea_asks
    ADD CONSTRAINT opensea_asks_token_id_fkey FOREIGN KEY (token_id) REFERENCES public.tokens(token_id);


--
-- Name: opensea_events_ingestion_deferred opensea_events_ingestion_deferred_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opensea_events_ingestion_deferred
    ADD CONSTRAINT opensea_events_ingestion_deferred_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.opensea_events_raw(event_id);


--
-- Name: opensea_events_ingestion_queue opensea_events_ingestion_queue_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opensea_events_ingestion_queue
    ADD CONSTRAINT opensea_events_ingestion_queue_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.opensea_events_raw(event_id);


--
-- Name: opensea_progress opensea_progress_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opensea_progress
    ADD CONSTRAINT opensea_progress_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(project_id);


--
-- Name: opensea_sales opensea_sales_currency_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opensea_sales
    ADD CONSTRAINT opensea_sales_currency_id_fkey FOREIGN KEY (currency_id) REFERENCES public.currencies(currency_id);


--
-- Name: opensea_sales opensea_sales_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opensea_sales
    ADD CONSTRAINT opensea_sales_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.opensea_events_raw(event_id);


--
-- Name: opensea_sales opensea_sales_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opensea_sales
    ADD CONSTRAINT opensea_sales_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(project_id);


--
-- Name: opensea_sales opensea_sales_token_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opensea_sales
    ADD CONSTRAINT opensea_sales_token_id_fkey FOREIGN KEY (token_id) REFERENCES public.tokens(token_id);


--
-- Name: tokens tokens_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tokens
    ADD CONSTRAINT tokens_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(project_id);


--
-- Name: trait_members trait_members_token_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trait_members
    ADD CONSTRAINT trait_members_token_id_fkey FOREIGN KEY (token_id) REFERENCES public.tokens(token_id);


--
-- Name: trait_members trait_members_trait_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trait_members
    ADD CONSTRAINT trait_members_trait_id_fkey FOREIGN KEY (trait_id) REFERENCES public.traits(trait_id);


--
-- PostgreSQL database dump complete
--

