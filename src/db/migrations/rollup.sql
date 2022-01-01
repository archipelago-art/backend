--- Archipelago SQL schema rollup
--- Generated: 2022-01-01T09:42:38.348Z
--- Scope: 57 migrations, through 0057_drop_project_newid_columns

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
-- Name: currencyid; Type: DOMAIN; Schema: public; Owner: -
--

CREATE DOMAIN public.currencyid AS bigint
	CONSTRAINT tokenid_range CHECK (((VALUE >= '1441151880758558720'::bigint) AND (VALUE <= '1729382256910270463'::bigint)));


--
-- Name: featureid; Type: DOMAIN; Schema: public; Owner: -
--

CREATE DOMAIN public.featureid AS bigint
	CONSTRAINT featureid_range CHECK (((VALUE >= '864691128455135232'::bigint) AND (VALUE <= '1152921504606846975'::bigint)));


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
	CONSTRAINT projectid_range CHECK (((VALUE >= '576460752303423488'::bigint) AND (VALUE <= '864691128455135231'::bigint)));


--
-- Name: tokenid; Type: DOMAIN; Schema: public; Owner: -
--

CREATE DOMAIN public.tokenid AS bigint
	CONSTRAINT tokenid_range CHECK (((VALUE >= '288230376151711744'::bigint) AND (VALUE <= '576460752303423487'::bigint)));


--
-- Name: traitid; Type: DOMAIN; Schema: public; Owner: -
--

CREATE DOMAIN public.traitid AS bigint
	CONSTRAINT traitid_range CHECK (((VALUE >= '1152921504606846976'::bigint) AND (VALUE <= '1441151880758558719'::bigint)));


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
-- Name: features; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.features (
    feature_id public.featureid NOT NULL,
    project_id public.projectid,
    name text NOT NULL
);


--
-- Name: features_feature_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.features_feature_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: features_feature_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.features_feature_id_seq OWNED BY public.features.feature_id;


--
-- Name: image_progress; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.image_progress (
    project_id public.projectid NOT NULL,
    completed_through_token_index integer
);


--
-- Name: opensea_events_raw; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.opensea_events_raw (
    event_id text NOT NULL,
    json jsonb NOT NULL,
    consumed boolean NOT NULL,
    event_type public.opensea_event_type NOT NULL
);


--
-- Name: opensea_progress; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.opensea_progress (
    opensea_slug text NOT NULL,
    until timestamp with time zone NOT NULL
);


--
-- Name: opensea_sales; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.opensea_sales (
    event_id text NOT NULL,
    token_contract public.address NOT NULL,
    token_id public.uint256 NOT NULL,
    sale_time timestamp with time zone NOT NULL,
    currency_contract public.address,
    price public.uint256 NOT NULL,
    buyer_address public.address NOT NULL,
    seller_address public.address NOT NULL,
    CONSTRAINT currency_contract_nonzero CHECK (((currency_contract)::bytea <> '\x0000000000000000000000000000000000000000'::bytea))
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
    token_id integer NOT NULL,
    fetch_time timestamp with time zone NOT NULL,
    token_data json,
    project_id public.projectid NOT NULL,
    token_contract public.address NOT NULL,
    on_chain_token_id public.uint256 NOT NULL,
    token_index integer NOT NULL,
    token_newid public.tokenid NOT NULL
);


--
-- Name: trait_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trait_members (
    trait_id public.traitid NOT NULL,
    token_id integer,
    token_contract public.address NOT NULL,
    on_chain_token_id public.uint256 NOT NULL,
    token_newid public.tokenid NOT NULL
);


--
-- Name: traits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.traits (
    trait_id public.traitid NOT NULL,
    feature_id public.featureid NOT NULL,
    value jsonb NOT NULL
);


--
-- Name: traits_trait_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.traits_trait_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: traits_trait_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.traits_trait_id_seq OWNED BY public.traits.trait_id;


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
-- Data for Name: features; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: image_progress; Type: TABLE DATA; Schema: public; Owner: -
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
-- Name: features_feature_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.features_feature_id_seq', 1, false);


--
-- Name: traits_trait_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.traits_trait_id_seq', 1, false);


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
-- Name: opensea_events_raw opensea_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opensea_events_raw
    ADD CONSTRAINT opensea_events_pkey PRIMARY KEY (event_id);


--
-- Name: opensea_progress opensea_progress_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opensea_progress
    ADD CONSTRAINT opensea_progress_pkey PRIMARY KEY (opensea_slug);


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
-- Name: tokens tokens_token_newid_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tokens
    ADD CONSTRAINT tokens_token_newid_key UNIQUE (token_newid);


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
-- Name: trait_members trait_members_token_newid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trait_members
    ADD CONSTRAINT trait_members_token_newid_fkey FOREIGN KEY (token_newid) REFERENCES public.tokens(token_newid);


--
-- Name: trait_members trait_members_trait_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trait_members
    ADD CONSTRAINT trait_members_trait_id_fkey FOREIGN KEY (trait_id) REFERENCES public.traits(trait_id);


--
-- PostgreSQL database dump complete
--

