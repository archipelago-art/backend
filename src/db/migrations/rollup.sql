--- Archipelago SQL schema rollup
--- Generated: 2022-06-23T00:54:20.282Z
--- Scope: 127 migrations, through 0127_drop_legacy_chain_tracking

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
-- Name: bidscope; Type: DOMAIN; Schema: public; Owner: -
--

CREATE DOMAIN public.bidscope AS bigint
	CONSTRAINT bidscope_type CHECK ((((VALUE >> 58) & (63)::bigint) = ANY (ARRAY[(1)::bigint, (2)::bigint, (4)::bigint, (8)::bigint])));


--
-- Name: bytes32; Type: DOMAIN; Schema: public; Owner: -
--

CREATE DOMAIN public.bytes32 AS bytea
	CONSTRAINT bytes32_length CHECK ((octet_length(VALUE) = 32));


--
-- Name: cnfid; Type: DOMAIN; Schema: public; Owner: -
--

CREATE DOMAIN public.cnfid AS bigint
	CONSTRAINT cnfid_type CHECK ((((VALUE >> 58) & (63)::bigint) = 8));


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
-- Name: orderid; Type: DOMAIN; Schema: public; Owner: -
--

CREATE DOMAIN public.orderid AS bigint
	CONSTRAINT orderid_type CHECK ((((VALUE >> 58) & (63)::bigint) = ANY (ARRAY[(6)::bigint, (7)::bigint])));


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
-- Name: account_emails; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.account_emails (
    account public.address NOT NULL,
    email text NOT NULL,
    create_time timestamp with time zone NOT NULL,
    unsubscribe_token uuid NOT NULL,
    preferences jsonb NOT NULL,
    CONSTRAINT preferences_is_object CHECK ((jsonb_typeof(preferences) = 'object'::text))
);


--
-- Name: artblocks_projects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.artblocks_projects (
    project_id public.projectid NOT NULL,
    artblocks_project_index integer NOT NULL,
    script_json jsonb NOT NULL,
    script text
);


--
-- Name: artblocks_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.artblocks_tokens (
    token_id public.tokenid NOT NULL,
    token_data json NOT NULL,
    fetch_time timestamp with time zone NOT NULL
);


--
-- Name: asks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asks (
    ask_id public.askid NOT NULL,
    project_id public.projectid NOT NULL,
    token_id public.tokenid NOT NULL,
    active boolean NOT NULL,
    price public.uint256 NOT NULL,
    deadline timestamp with time zone NOT NULL,
    create_time timestamp with time zone NOT NULL,
    asker public.address NOT NULL,
    nonce public.uint256 NOT NULL,
    agreement bytea NOT NULL,
    message bytea NOT NULL,
    signature public.signature NOT NULL,
    active_token_owner boolean NOT NULL,
    active_token_operator boolean NOT NULL,
    active_token_operator_for_all boolean NOT NULL,
    active_market_approved boolean NOT NULL,
    active_market_approved_for_all boolean NOT NULL,
    active_nonce boolean NOT NULL,
    active_deadline boolean NOT NULL,
    CONSTRAINT active_value CHECK ((active = ((active_token_owner OR active_token_operator OR active_token_operator_for_all) AND (active_market_approved OR active_market_approved_for_all) AND active_nonce AND active_deadline)))
);


--
-- Name: auth_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_tokens (
    auth_token uuid NOT NULL,
    account public.address NOT NULL,
    create_time timestamp with time zone NOT NULL
);


--
-- Name: bids; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bids (
    bid_id public.bidid NOT NULL,
    project_id public.projectid NOT NULL,
    scope public.bidscope NOT NULL,
    active boolean NOT NULL,
    price public.uint256 NOT NULL,
    deadline timestamp with time zone NOT NULL,
    create_time timestamp with time zone NOT NULL,
    bidder public.address NOT NULL,
    nonce public.uint256 NOT NULL,
    agreement bytea NOT NULL,
    message bytea NOT NULL,
    signature public.signature NOT NULL,
    active_currency_balance boolean NOT NULL,
    active_market_approved boolean NOT NULL,
    active_nonce boolean NOT NULL,
    active_deadline boolean NOT NULL,
    CONSTRAINT active_value CHECK ((active = (active_currency_balance AND active_market_approved AND active_nonce AND active_deadline)))
);


--
-- Name: bidscopes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bidscopes (
    scope public.bidscope NOT NULL,
    token_id public.tokenid GENERATED ALWAYS AS (
CASE
    WHEN ((((scope)::bigint >> 58) & (63)::bigint) = 1) THEN (scope)::bigint
    ELSE NULL::bigint
END) STORED,
    project_id public.projectid GENERATED ALWAYS AS (
CASE
    WHEN ((((scope)::bigint >> 58) & (63)::bigint) = 2) THEN (scope)::bigint
    ELSE NULL::bigint
END) STORED,
    trait_id public.traitid GENERATED ALWAYS AS (
CASE
    WHEN ((((scope)::bigint >> 58) & (63)::bigint) = 4) THEN (scope)::bigint
    ELSE NULL::bigint
END) STORED,
    cnf_id public.cnfid GENERATED ALWAYS AS (
CASE
    WHEN ((((scope)::bigint >> 58) & (63)::bigint) = 8) THEN (scope)::bigint
    ELSE NULL::bigint
END) STORED,
    CONSTRAINT bidscopes_exactly_one_key CHECK ((((((0 + ((token_id IS NOT NULL))::integer) + ((project_id IS NOT NULL))::integer) + ((trait_id IS NOT NULL))::integer) + ((cnf_id IS NOT NULL))::integer) = 1))
);


--
-- Name: cnf_clauses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cnf_clauses (
    cnf_id public.cnfid NOT NULL,
    clause_idx integer NOT NULL,
    trait_id public.traitid NOT NULL
);


--
-- Name: cnf_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cnf_members (
    cnf_id public.cnfid NOT NULL,
    token_id public.tokenid NOT NULL
);


--
-- Name: cnf_trait_update_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cnf_trait_update_queue (
    token_id public.tokenid NOT NULL,
    traits_last_update_time timestamp with time zone NOT NULL
);


--
-- Name: cnfs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cnfs (
    cnf_id public.cnfid NOT NULL,
    project_id public.projectid NOT NULL,
    canonical_form text NOT NULL,
    digest uuid NOT NULL
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
-- Name: erc20_balances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.erc20_balances (
    currency_id public.currencyid NOT NULL,
    account public.address NOT NULL,
    balance public.uint256 NOT NULL
);


--
-- Name: erc20_deltas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.erc20_deltas (
    currency_id public.currencyid NOT NULL,
    account public.address NOT NULL,
    block_hash public.bytes32 NOT NULL,
    delta numeric(78,0) NOT NULL
);


--
-- Name: erc721_transfers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.erc721_transfers (
    token_id public.tokenid NOT NULL,
    from_address public.address NOT NULL,
    to_address public.address NOT NULL,
    block_hash public.bytes32 NOT NULL,
    block_number integer NOT NULL,
    log_index integer NOT NULL,
    transaction_hash public.bytes32 NOT NULL
);


--
-- Name: eth_blocks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.eth_blocks (
    block_hash public.bytes32 NOT NULL,
    parent_hash public.bytes32,
    block_number integer NOT NULL,
    block_timestamp timestamp with time zone NOT NULL,
    CONSTRAINT eth_blocks_parent_hash_mostly_non_null CHECK (((parent_hash IS NULL) = (block_number = 0)))
);


--
-- Name: eth_job_progress; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.eth_job_progress (
    job_id integer NOT NULL,
    last_block_number integer NOT NULL,
    job_type text NOT NULL,
    job_args jsonb NOT NULL
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
-- Name: fills; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fills (
    market_contract public.address NOT NULL,
    trade_id public.bytes32 NOT NULL,
    token_id public.tokenid,
    project_id public.projectid,
    token_contract public.address NOT NULL,
    on_chain_token_id public.uint256 NOT NULL,
    buyer public.address NOT NULL,
    seller public.address NOT NULL,
    currency_id public.currencyid NOT NULL,
    price public.uint256 NOT NULL,
    proceeds public.uint256 NOT NULL,
    cost public.uint256 NOT NULL,
    block_hash public.bytes32 NOT NULL,
    block_number integer NOT NULL,
    log_index integer NOT NULL,
    transaction_hash public.bytes32 NOT NULL,
    CONSTRAINT token_id_iff_project_id CHECK (((token_id IS NULL) = (project_id IS NULL)))
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
-- Name: nonce_cancellations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.nonce_cancellations (
    market_contract public.address NOT NULL,
    account public.address NOT NULL,
    nonce public.uint256 NOT NULL,
    block_hash public.bytes32 NOT NULL,
    block_number integer NOT NULL,
    log_index integer NOT NULL,
    transaction_hash public.bytes32 NOT NULL
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
    price public.uint256 NOT NULL
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
-- Name: pending_email_confirmations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pending_email_confirmations (
    nonce uuid NOT NULL,
    account public.address NOT NULL,
    email text NOT NULL,
    create_time timestamp with time zone NOT NULL,
    attempt integer NOT NULL
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
    aspect_ratio double precision,
    num_tokens integer NOT NULL,
    slug text NOT NULL,
    token_contract public.address NOT NULL,
    image_template text NOT NULL
);


--
-- Name: token_traits_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.token_traits_queue (
    token_id public.tokenid NOT NULL,
    create_time timestamp with time zone NOT NULL
);


--
-- Name: tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tokens (
    token_id public.tokenid NOT NULL,
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
-- Name: websocket_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.websocket_log (
    message_id uuid NOT NULL,
    create_time timestamp with time zone NOT NULL,
    message_type text NOT NULL,
    topic text NOT NULL,
    data jsonb NOT NULL
);


--
-- Data for Name: account_emails; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: artblocks_projects; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: artblocks_tokens; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: asks; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: auth_tokens; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: bids; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: bidscopes; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: cnf_clauses; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: cnf_members; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: cnf_trait_update_queue; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: cnfs; Type: TABLE DATA; Schema: public; Owner: -
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
-- Data for Name: erc20_balances; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: erc20_deltas; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: erc721_transfers; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: eth_blocks; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: eth_job_progress; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: features; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: fills; Type: TABLE DATA; Schema: public; Owner: -
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
INSERT INTO public.migration_log VALUES (599676429728366902, '0089_ab_concept_migrations', '2001-01-01 00:00:14+00', '\x11783d9fa654f2be12b469a8ba1a377a7095fc39');
INSERT INTO public.migration_log VALUES (1036566401064465191, '0090_ab_concept_cleanup', '2001-01-01 00:00:15+00', '\xdad9a0b7dd37bb0fa55fd56e9a4c6dba124b1acf');
INSERT INTO public.migration_log VALUES (799370710744540593, '0091_ab_fetch_time', '2001-01-01 00:00:16+00', '\xacdddf74ac5e681fca2b73df8010df10c6cfaa46');
INSERT INTO public.migration_log VALUES (311369877284736209, '0092_tokens_fetch_time_nullable', '2001-01-01 00:00:17+00', '\xb3a0ada03255764038f90a718fca31d6d914d139');
INSERT INTO public.migration_log VALUES (354822959247932695, '0093_tokens_drop_fetch_time', '2001-01-01 00:00:18+00', '\x7681f3baa3c3c6bb5ff4b30bdb6c83a664c4e6e9');
INSERT INTO public.migration_log VALUES (666549354056340093, '0094_projects_slug_not_null', '2001-01-01 00:00:19+00', '\x752e3b51610354d75f4e993a90376861229a5bb1');
INSERT INTO public.migration_log VALUES (1106939444957158766, '0095_projects_image_template', '2001-01-01 00:00:20+00', '\x3853915db4153db00639b85cbf85f0f378ad6880');
INSERT INTO public.migration_log VALUES (501225986829187898, '0096_projects_image_template_not_null', '2001-01-01 00:00:21+00', '\xddcd07c5a4633431e5cffc029fb964057417486c');
INSERT INTO public.migration_log VALUES (542107527231516464, '0097_opensea_cancellations', '2001-01-01 00:00:22+00', '\xb76268634fce00fee31d687ec011c6577f62dc3f');
INSERT INTO public.migration_log VALUES (375481231642615256, '0098_auth_tokens_and_account_emails', '2001-01-01 00:00:23+00', '\xf9f2af106d91e2d0f3bcc7c7a575f9959d1d4a81');
INSERT INTO public.migration_log VALUES (874637339070897785, '0099_archipelago_orderbook', '2001-01-01 00:00:24+00', '\x39bdd5f907091e318742f72f85a180e15877887f');
INSERT INTO public.migration_log VALUES (827068620417233394, '0100_bidscopes_forwarding_table', '2001-01-01 00:00:25+00', '\xba4c88c779ec981b7c95ac29045e6247ba9ec217');
INSERT INTO public.migration_log VALUES (430591478256551749, '0101_bids_scope_fkey', '2001-01-01 00:00:26+00', '\x1617eb164d8c4c006f1a98952f75d8d00f39f8ea');
INSERT INTO public.migration_log VALUES (463984135224165397, '0102_traits_features_foreign_key', '2001-01-01 00:00:27+00', '\xa3e8ff767fbbc1a6f5a0703c1fd43a752a660ffc');
INSERT INTO public.migration_log VALUES (404788987171034015, '0103_eth_blocks_rename_to_eth_blocks1', '2001-01-01 00:00:28+00', '\xb9271b752aecf3e7e44e417fe65332bacb918463');
INSERT INTO public.migration_log VALUES (239031262286455689, '0104_eth_events', '2001-01-01 00:00:29+00', '\x77ca8abfa7976cd37ecd202f1ff919649475806e');
INSERT INTO public.migration_log VALUES (442678827534637247, '0105_eth_blocks_semi_nullable_parent_hash', '2001-01-01 00:00:30+00', '\x21f8c050d97bab0f7d9e5ec0a43cdb4bac8fa849');
INSERT INTO public.migration_log VALUES (1058877245160011415, '0106_eth_blocks_parent_hash_self_fkey', '2001-01-01 00:00:31+00', '\xd949b7e8f2f073723fdb45f9a4e0cc26be52d5e1');
INSERT INTO public.migration_log VALUES (1020568623502469019, '0107_index_eth_blocks_parent_hash', '2001-01-01 00:00:32+00', '\x8fe91f7ec72e5648b1b48ae974e4425a71a8fd43');
INSERT INTO public.migration_log VALUES (895999470687528241, '0108_index_erc_721_transfers_to_address_from_address', '2001-01-01 00:00:33+00', '\xbaa4884e9dc4cb28348bcc92771643accfe0d970');
INSERT INTO public.migration_log VALUES (607511049093539347, '0109_eth_blocks_remove_nonzero_parent_hash_constraint', '2001-01-01 00:00:34+00', '\x1afcf1d4f2d848bf5454c2332c051a009fc987bd');
INSERT INTO public.migration_log VALUES (716424346322625971, '0110_artblocks_tokens_token_id_fkey', '2001-01-01 00:00:35+00', '\x9458fc595b1a7d3a4befd96d9bff1dcbf41034e9');
INSERT INTO public.migration_log VALUES (534328052949130286, '0111_token_traits_queue', '2001-01-01 00:00:36+00', '\x3c14e7ee37dbf0c6293d442db890eaca23d60919');
INSERT INTO public.migration_log VALUES (551158049576579034, '0112_new_erc721_transfers', '2001-01-01 00:00:37+00', '\x059b73f8182deb063e2dc7fd3c7f3642fac165d5');
INSERT INTO public.migration_log VALUES (786601695974833842, '0113_erc721_transfers_adjust_unique_constraint', '2001-01-01 00:00:38+00', '\xa5c343d8f45b3cbaf7c0e25bb39f721cb40fc41f');
INSERT INTO public.migration_log VALUES (52099895664875051, '0114_index_erc721_transfers_to_address_and_from_address', '2001-01-01 00:00:39+00', '\x8fabf03b3517d5f39f0276f0ccc9bb90153a804a');
INSERT INTO public.migration_log VALUES (962060498573789176, '0115_websocket_log', '2001-01-01 00:00:40+00', '\x86181e49621caf94b13b506adc0308a08267a824');
INSERT INTO public.migration_log VALUES (277275912621038784, '0116_fix_index_erc721_transfers_from_address', '2001-01-01 00:00:41+00', '\x2dae3cd685cd6b564c21840a2ff85a681d0cd48f');
INSERT INTO public.migration_log VALUES (519169372877842664, '0117_deprecate_legacy_chain_tracking', '2001-01-01 00:00:42+00', '\xb3e25ad450d9d87207b130bde1496956fb9e06ba');
INSERT INTO public.migration_log VALUES (309823894458484746, '0118_fine_grained_activity_fields', '2001-01-01 00:00:43+00', '\x973afbe209fa2a8f60e4268245c3106f9b631af1');
INSERT INTO public.migration_log VALUES (513098483772537257, '0119_fine_grained_activity_constraints', '2001-01-01 00:00:44+00', '\x8508b7a7108591698719d4dea61fe23a8a515008');
INSERT INTO public.migration_log VALUES (581378227087242413, '0120_index_bids_asks_account_nonce', '2001-01-01 00:00:45+00', '\x796be1632af46a9e36a4b4f51963218a10b282ae');
INSERT INTO public.migration_log VALUES (171067409391666771, '0121_on_chain_nonce_cancellations', '2001-01-01 00:00:46+00', '\x382fc94eaffc13232e590027b7ea9c1aeb0ed60e');
INSERT INTO public.migration_log VALUES (221952938061928149, '0122_on_chain_fills', '2001-01-01 00:00:47+00', '\x9a80af8fb422465cc972efdf134a75f36b1bb93f');
INSERT INTO public.migration_log VALUES (684565549752056241, '0123_fills_rename_currency_to_currency_id', '2001-01-01 00:00:48+00', '\xc633ef5e2034add1eed14ca03875383346b1a045');
INSERT INTO public.migration_log VALUES (63470050231968117, '0124_data_oriented_jobs', '2001-01-01 00:00:49+00', '\xaade577207ccc14d63fca14443b347cf969bb2f6');
INSERT INTO public.migration_log VALUES (118877159517264337, '0125_jobs_type_and_args_not_null', '2001-01-01 00:00:50+00', '\x5bfcdfd4524a0930177cd306420a839d77121116');
INSERT INTO public.migration_log VALUES (13990938940009520, '0126_erc20_balances', '2001-01-01 00:00:51+00', '\xfb5c9495d7f1f84913a55e4417eb54bc44e409d9');
INSERT INTO public.migration_log VALUES (296388808787432059, '0127_drop_legacy_chain_tracking', '2001-01-01 00:00:52+00', '\xbdf124c3c7023d9898b81f2fab608d6d9c03c190');


--
-- Data for Name: nonce_cancellations; Type: TABLE DATA; Schema: public; Owner: -
--



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
-- Data for Name: pending_email_confirmations; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: projects; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: token_traits_queue; Type: TABLE DATA; Schema: public; Owner: -
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
-- Data for Name: websocket_log; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Name: account_emails account_emails_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_emails
    ADD CONSTRAINT account_emails_pkey PRIMARY KEY (account);


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
-- Name: artblocks_tokens artblocks_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artblocks_tokens
    ADD CONSTRAINT artblocks_tokens_pkey PRIMARY KEY (token_id);


--
-- Name: asks asks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asks
    ADD CONSTRAINT asks_pkey PRIMARY KEY (ask_id);


--
-- Name: auth_tokens auth_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_tokens
    ADD CONSTRAINT auth_tokens_pkey PRIMARY KEY (auth_token);


--
-- Name: bids bids_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bids
    ADD CONSTRAINT bids_pkey PRIMARY KEY (bid_id);


--
-- Name: bidscopes bidscopes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bidscopes
    ADD CONSTRAINT bidscopes_pkey PRIMARY KEY (scope);


--
-- Name: cnf_clauses cnf_clauses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cnf_clauses
    ADD CONSTRAINT cnf_clauses_pkey PRIMARY KEY (cnf_id, clause_idx, trait_id);


--
-- Name: cnf_members cnf_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cnf_members
    ADD CONSTRAINT cnf_members_pkey PRIMARY KEY (cnf_id, token_id);


--
-- Name: cnf_trait_update_queue cnf_trait_update_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cnf_trait_update_queue
    ADD CONSTRAINT cnf_trait_update_queue_pkey PRIMARY KEY (token_id);


--
-- Name: cnfs cnfs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cnfs
    ADD CONSTRAINT cnfs_pkey PRIMARY KEY (cnf_id);


--
-- Name: cnfs cnfs_project_id_digest_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cnfs
    ADD CONSTRAINT cnfs_project_id_digest_key UNIQUE (project_id, digest);


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
-- Name: erc20_balances erc20_balances_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.erc20_balances
    ADD CONSTRAINT erc20_balances_pkey PRIMARY KEY (currency_id, account);


--
-- Name: erc20_deltas erc20_deltas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.erc20_deltas
    ADD CONSTRAINT erc20_deltas_pkey PRIMARY KEY (currency_id, account, block_hash);


--
-- Name: erc721_transfers erc721_transfers_block_number_log_index_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.erc721_transfers
    ADD CONSTRAINT erc721_transfers_block_number_log_index_key UNIQUE (block_number, log_index);


--
-- Name: eth_blocks eth_blocks_block_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eth_blocks
    ADD CONSTRAINT eth_blocks_block_number_key UNIQUE (block_number);


--
-- Name: eth_blocks eth_blocks_pkey1; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eth_blocks
    ADD CONSTRAINT eth_blocks_pkey1 PRIMARY KEY (block_hash);


--
-- Name: eth_job_progress eth_job_progress_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eth_job_progress
    ADD CONSTRAINT eth_job_progress_pkey PRIMARY KEY (job_id);


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
-- Name: fills fills_block_hash_log_index_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fills
    ADD CONSTRAINT fills_block_hash_log_index_key UNIQUE (block_hash, log_index);


--
-- Name: fills fills_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fills
    ADD CONSTRAINT fills_pkey PRIMARY KEY (market_contract, trade_id);


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
-- Name: nonce_cancellations nonce_cancellations_block_hash_log_index_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nonce_cancellations
    ADD CONSTRAINT nonce_cancellations_block_hash_log_index_key UNIQUE (block_hash, log_index);


--
-- Name: nonce_cancellations nonce_cancellations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nonce_cancellations
    ADD CONSTRAINT nonce_cancellations_pkey PRIMARY KEY (market_contract, account, nonce);


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
-- Name: pending_email_confirmations pending_email_confirmations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_email_confirmations
    ADD CONSTRAINT pending_email_confirmations_pkey PRIMARY KEY (nonce);


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
-- Name: token_traits_queue token_traits_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.token_traits_queue
    ADD CONSTRAINT token_traits_queue_pkey PRIMARY KEY (token_id);


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
-- Name: websocket_log websocket_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.websocket_log
    ADD CONSTRAINT websocket_log_pkey PRIMARY KEY (message_id);


--
-- Name: ask_project_id_price_create_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ask_project_id_price_create_time ON public.asks USING btree (project_id, price, create_time) INCLUDE (ask_id) WHERE active;


--
-- Name: ask_token_id_price_create_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ask_token_id_price_create_time ON public.asks USING btree (token_id, price, create_time) INCLUDE (ask_id) WHERE active;


--
-- Name: asks_address_nonce; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX asks_address_nonce ON public.asks USING btree (asker, nonce) WHERE active_deadline;


--
-- Name: auth_tokens_account; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_tokens_account ON public.auth_tokens USING btree (account) INCLUDE (auth_token);


--
-- Name: bids_bidder_nonce; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bids_bidder_nonce ON public.bids USING btree (bidder, nonce) WHERE active_deadline;


--
-- Name: bids_scope_price_create_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bids_scope_price_create_time ON public.bids USING btree (scope, price DESC, create_time) INCLUDE (bid_id) WHERE active;


--
-- Name: cnf_members_token_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cnf_members_token_id ON public.cnf_members USING btree (token_id);


--
-- Name: erc20_deltas_currency_id_block_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX erc20_deltas_currency_id_block_hash ON public.erc20_deltas USING btree (currency_id, block_hash);


--
-- Name: erc721_transfers_block_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX erc721_transfers_block_hash ON public.erc721_transfers USING btree (block_hash);


--
-- Name: erc721_transfers_from_address; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX erc721_transfers_from_address ON public.erc721_transfers USING btree (from_address);


--
-- Name: erc721_transfers_to_address; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX erc721_transfers_to_address ON public.erc721_transfers USING btree (to_address);


--
-- Name: erc721_transfers_token_id_block_number_log_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX erc721_transfers_token_id_block_number_log_index ON public.erc721_transfers USING btree (token_id, block_number DESC, log_index DESC);


--
-- Name: eth_blocks_block_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX eth_blocks_block_number ON public.eth_blocks USING btree (block_number DESC) INCLUDE (block_hash);


--
-- Name: eth_blocks_parent_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX eth_blocks_parent_hash ON public.eth_blocks USING btree (parent_hash);


--
-- Name: fills_for_unknown_tokens; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fills_for_unknown_tokens ON public.fills USING btree (token_contract, on_chain_token_id) WHERE (token_id IS NULL);


--
-- Name: fills_market_contract_block_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fills_market_contract_block_hash ON public.fills USING btree (market_contract, block_hash);


--
-- Name: fills_project_id_block_number_log_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fills_project_id_block_number_log_index ON public.fills USING btree (project_id, block_number DESC, log_index DESC) INCLUDE (token_id);


--
-- Name: fills_token_id_block_number_log_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fills_token_id_block_number_log_index ON public.fills USING btree (token_id, block_number DESC, log_index DESC);


--
-- Name: nonce_cancellations_market_contract_block_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX nonce_cancellations_market_contract_block_hash ON public.nonce_cancellations USING btree (market_contract, block_hash);


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
-- Name: pending_email_confirmations_account; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pending_email_confirmations_account ON public.pending_email_confirmations USING btree (account);


--
-- Name: pending_email_confirmations_email_attempt; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pending_email_confirmations_email_attempt ON public.pending_email_confirmations USING btree (email, attempt DESC) INCLUDE (create_time);


--
-- Name: projects_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX projects_slug ON public.projects USING btree (slug);


--
-- Name: token_traits_queue_create_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX token_traits_queue_create_time ON public.token_traits_queue USING btree (create_time);


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
-- Name: websocket_log_create_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX websocket_log_create_time ON public.websocket_log USING btree (create_time);


--
-- Name: websocket_log_topic_create_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX websocket_log_topic_create_time ON public.websocket_log USING btree (topic, create_time);


--
-- Name: artblocks_projects artblocks_projects_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artblocks_projects
    ADD CONSTRAINT artblocks_projects_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(project_id);


--
-- Name: artblocks_tokens artblocks_tokens_token_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artblocks_tokens
    ADD CONSTRAINT artblocks_tokens_token_id_fkey FOREIGN KEY (token_id) REFERENCES public.tokens(token_id);


--
-- Name: asks asks_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asks
    ADD CONSTRAINT asks_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(project_id);


--
-- Name: asks asks_token_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asks
    ADD CONSTRAINT asks_token_id_fkey FOREIGN KEY (token_id) REFERENCES public.tokens(token_id);


--
-- Name: bids bids_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bids
    ADD CONSTRAINT bids_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(project_id);


--
-- Name: bids bids_scope_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bids
    ADD CONSTRAINT bids_scope_fkey FOREIGN KEY (scope) REFERENCES public.bidscopes(scope);


--
-- Name: bidscopes bidscopes_cnf_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bidscopes
    ADD CONSTRAINT bidscopes_cnf_id_fkey FOREIGN KEY (cnf_id) REFERENCES public.cnfs(cnf_id);


--
-- Name: bidscopes bidscopes_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bidscopes
    ADD CONSTRAINT bidscopes_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(project_id);


--
-- Name: bidscopes bidscopes_token_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bidscopes
    ADD CONSTRAINT bidscopes_token_id_fkey FOREIGN KEY (token_id) REFERENCES public.tokens(token_id);


--
-- Name: bidscopes bidscopes_trait_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bidscopes
    ADD CONSTRAINT bidscopes_trait_id_fkey FOREIGN KEY (trait_id) REFERENCES public.traits(trait_id);


--
-- Name: cnf_clauses cnf_clauses_cnf_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cnf_clauses
    ADD CONSTRAINT cnf_clauses_cnf_id_fkey FOREIGN KEY (cnf_id) REFERENCES public.cnfs(cnf_id);


--
-- Name: cnf_clauses cnf_clauses_trait_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cnf_clauses
    ADD CONSTRAINT cnf_clauses_trait_id_fkey FOREIGN KEY (trait_id) REFERENCES public.traits(trait_id);


--
-- Name: cnf_members cnf_members_cnf_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cnf_members
    ADD CONSTRAINT cnf_members_cnf_id_fkey FOREIGN KEY (cnf_id) REFERENCES public.cnfs(cnf_id);


--
-- Name: cnf_members cnf_members_token_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cnf_members
    ADD CONSTRAINT cnf_members_token_id_fkey FOREIGN KEY (token_id) REFERENCES public.tokens(token_id);


--
-- Name: cnfs cnfs_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cnfs
    ADD CONSTRAINT cnfs_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(project_id);


--
-- Name: erc20_deltas erc20_deltas_block_hash_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.erc20_deltas
    ADD CONSTRAINT erc20_deltas_block_hash_fkey FOREIGN KEY (block_hash) REFERENCES public.eth_blocks(block_hash);


--
-- Name: erc721_transfers erc721_transfers_block_hash_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.erc721_transfers
    ADD CONSTRAINT erc721_transfers_block_hash_fkey FOREIGN KEY (block_hash) REFERENCES public.eth_blocks(block_hash);


--
-- Name: erc721_transfers erc721_transfers_token_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.erc721_transfers
    ADD CONSTRAINT erc721_transfers_token_id_fkey FOREIGN KEY (token_id) REFERENCES public.tokens(token_id);


--
-- Name: eth_blocks eth_blocks_parent_hash_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eth_blocks
    ADD CONSTRAINT eth_blocks_parent_hash_fkey FOREIGN KEY (parent_hash) REFERENCES public.eth_blocks(block_hash);


--
-- Name: features features_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.features
    ADD CONSTRAINT features_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(project_id);


--
-- Name: fills fills_block_hash_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fills
    ADD CONSTRAINT fills_block_hash_fkey FOREIGN KEY (block_hash) REFERENCES public.eth_blocks(block_hash);


--
-- Name: fills fills_currency_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fills
    ADD CONSTRAINT fills_currency_fkey FOREIGN KEY (currency_id) REFERENCES public.currencies(currency_id);


--
-- Name: fills fills_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fills
    ADD CONSTRAINT fills_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(project_id);


--
-- Name: fills fills_token_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fills
    ADD CONSTRAINT fills_token_id_fkey FOREIGN KEY (token_id) REFERENCES public.tokens(token_id);


--
-- Name: image_progress image_progress_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.image_progress
    ADD CONSTRAINT image_progress_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(project_id);


--
-- Name: nonce_cancellations nonce_cancellations_block_hash_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nonce_cancellations
    ADD CONSTRAINT nonce_cancellations_block_hash_fkey FOREIGN KEY (block_hash) REFERENCES public.eth_blocks(block_hash);


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
-- Name: token_traits_queue token_traits_queue_token_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.token_traits_queue
    ADD CONSTRAINT token_traits_queue_token_id_fkey FOREIGN KEY (token_id) REFERENCES public.tokens(token_id);


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
-- Name: traits traits_feature_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.traits
    ADD CONSTRAINT traits_feature_id_fkey FOREIGN KEY (feature_id) REFERENCES public.features(feature_id);


--
-- PostgreSQL database dump complete
--

