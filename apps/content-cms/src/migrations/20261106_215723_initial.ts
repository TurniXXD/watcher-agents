import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_events_free_food" AS ENUM('yes', 'no', 'unknown');
  CREATE TYPE "public"."enum_events_event_status" AS ENUM('scheduled', 'cancelled', 'postponed');
  CREATE TYPE "public"."enum_events_review_status" AS ENUM('ingested', 'needs_review', 'approved', 'rejected', 'archived');
  CREATE TYPE "public"."enum_events_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum__events_v_version_free_food" AS ENUM('yes', 'no', 'unknown');
  CREATE TYPE "public"."enum__events_v_version_event_status" AS ENUM('scheduled', 'cancelled', 'postponed');
  CREATE TYPE "public"."enum__events_v_version_review_status" AS ENUM('ingested', 'needs_review', 'approved', 'rejected', 'archived');
  CREATE TYPE "public"."enum__events_v_version_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum_articles_review_status" AS ENUM('ingested', 'needs_review', 'approved', 'rejected', 'archived');
  CREATE TYPE "public"."enum_articles_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum__articles_v_version_review_status" AS ENUM('ingested', 'needs_review', 'approved', 'rejected', 'archived');
  CREATE TYPE "public"."enum__articles_v_version_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum_news_review_status" AS ENUM('ingested', 'needs_review', 'approved', 'rejected', 'archived');
  CREATE TYPE "public"."enum_news_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum__news_v_version_review_status" AS ENUM('ingested', 'needs_review', 'approved', 'rejected', 'archived');
  CREATE TYPE "public"."enum__news_v_version_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum_publications_review_status" AS ENUM('ingested', 'needs_review', 'approved', 'rejected', 'archived');
  CREATE TYPE "public"."enum_publications_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum__publications_v_version_review_status" AS ENUM('ingested', 'needs_review', 'approved', 'rejected', 'archived');
  CREATE TYPE "public"."enum__publications_v_version_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum_social_posts_platform" AS ENUM('instagram', 'linkedin', 'tiktok', 'youtube', 'x');
  CREATE TYPE "public"."enum_social_posts_post_type" AS ENUM('post', 'carousel', 'story', 'reel', 'short', 'video');
  CREATE TYPE "public"."enum_social_posts_publishing_status" AS ENUM('draft', 'scheduled', 'published', 'failed', 'cancelled');
  CREATE TYPE "public"."enum_social_posts_review_status" AS ENUM('ingested', 'needs_review', 'approved', 'rejected', 'archived');
  CREATE TYPE "public"."enum_social_posts_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum__social_posts_v_version_platform" AS ENUM('instagram', 'linkedin', 'tiktok', 'youtube', 'x');
  CREATE TYPE "public"."enum__social_posts_v_version_post_type" AS ENUM('post', 'carousel', 'story', 'reel', 'short', 'video');
  CREATE TYPE "public"."enum__social_posts_v_version_publishing_status" AS ENUM('draft', 'scheduled', 'published', 'failed', 'cancelled');
  CREATE TYPE "public"."enum__social_posts_v_version_review_status" AS ENUM('ingested', 'needs_review', 'approved', 'rejected', 'archived');
  CREATE TYPE "public"."enum__social_posts_v_version_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum_media_usage_rights" AS ENUM('owned', 'licensed', 'permission_granted', 'public_domain', 'creative_commons', 'unknown', 'not_permitted');
  CREATE TYPE "public"."enum_media_visibility" AS ENUM('private', 'public');
  CREATE TYPE "public"."enum_sources_source_type" AS ENUM('website', 'rss', 'api', 'ical', 'social', 'other');
  CREATE TYPE "public"."enum_sources_usage_rights" AS ENUM('facts_only', 'licensed', 'permission_granted', 'open_license', 'unknown', 'do_not_use');
  CREATE TYPE "public"."enum_ingestion_runs_target_collection" AS ENUM('events', 'articles', 'news', 'publications', 'social-posts');
  CREATE TYPE "public"."enum_ingestion_runs_status" AS ENUM('running', 'succeeded', 'partial', 'failed');
  CREATE TYPE "public"."enum_pending_updates_target_collection" AS ENUM('events', 'articles', 'news', 'publications', 'social-posts');
  CREATE TYPE "public"."enum_pending_updates_status" AS ENUM('pending', 'applied', 'dismissed');
  CREATE TYPE "public"."enum_pending_updates_severity" AS ENUM('normal', 'critical');
  CREATE TYPE "public"."enum_ingestion_records_target_collection" AS ENUM('events', 'articles', 'news', 'publications', 'social-posts');
  CREATE TYPE "public"."enum_users_role" AS ENUM('admin', 'reviewer', 'editor');
  CREATE TYPE "public"."enum_ingestion_clients_scopes" AS ENUM('events', 'articles', 'news', 'publications', 'social-posts');
  CREATE TYPE "public"."enum_payload_jobs_log_task_slug" AS ENUM('inline', 'schedulePublish');
  CREATE TYPE "public"."enum_payload_jobs_log_state" AS ENUM('failed', 'succeeded');
  CREATE TYPE "public"."enum_payload_jobs_task_slug" AS ENUM('inline', 'schedulePublish');
  CREATE TABLE "events_source_references" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"title" varchar,
  	"url" varchar,
  	"publisher" varchar,
  	"accessed_at" timestamp(3) with time zone,
  	"source_id" uuid
  );
  
  CREATE TABLE "events" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"title" varchar,
  	"slug" varchar,
  	"summary" varchar,
  	"description" jsonb,
  	"starts_at" timestamp(3) with time zone,
  	"ends_at" timestamp(3) with time zone,
  	"timezone" varchar DEFAULT 'Europe/Prague',
  	"city" varchar DEFAULT 'Brno',
  	"venue_name" varchar,
  	"address" varchar,
  	"city_slug" varchar,
  	"category" varchar DEFAULT 'other',
  	"organizer_name" varchar,
  	"source_url" varchar,
  	"registration_url" varchar,
  	"image_id" uuid,
  	"source_image_url" varchar,
  	"is_free" boolean,
  	"price" numeric,
  	"currency" varchar,
  	"free_food" "enum_events_free_food" DEFAULT 'unknown',
  	"food_details" varchar,
  	"food_evidence" jsonb,
  	"event_status" "enum_events_event_status" DEFAULT 'scheduled',
  	"featured" boolean DEFAULT false,
  	"last_verified_at" timestamp(3) with time zone,
  	"critical_update_pending_since" timestamp(3) with time zone,
  	"source_excerpt" varchar,
  	"seo_title" varchar,
  	"seo_description" varchar,
  	"seo_image_id" uuid,
  	"seo_no_index" boolean DEFAULT false,
  	"review_status" "enum_events_review_status" DEFAULT 'needs_review',
  	"source_bot" varchar,
  	"external_id" varchar,
  	"has_pending_updates" boolean DEFAULT false,
  	"human_edited_fields" jsonb,
  	"review_notes" varchar,
  	"ai_provenance_generated_by_a_i" boolean DEFAULT false,
  	"ai_provenance_generator" varchar,
  	"ai_provenance_model" varchar,
  	"ai_provenance_generated_at" timestamp(3) with time zone,
  	"ai_provenance_notes" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"_status" "enum_events_status" DEFAULT 'draft'
  );
  
  CREATE TABLE "events_texts" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer NOT NULL,
  	"parent_id" uuid NOT NULL,
  	"path" varchar NOT NULL,
  	"text" varchar
  );
  
  CREATE TABLE "_events_v_version_source_references" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"title" varchar,
  	"url" varchar,
  	"publisher" varchar,
  	"accessed_at" timestamp(3) with time zone,
  	"source_id" uuid,
  	"_uuid" varchar
  );
  
  CREATE TABLE "_events_v" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"parent_id" uuid,
  	"version_title" varchar,
  	"version_slug" varchar,
  	"version_summary" varchar,
  	"version_description" jsonb,
  	"version_starts_at" timestamp(3) with time zone,
  	"version_ends_at" timestamp(3) with time zone,
  	"version_timezone" varchar DEFAULT 'Europe/Prague',
  	"version_city" varchar DEFAULT 'Brno',
  	"version_venue_name" varchar,
  	"version_address" varchar,
  	"version_city_slug" varchar,
  	"version_category" varchar DEFAULT 'other',
  	"version_organizer_name" varchar,
  	"version_source_url" varchar,
  	"version_registration_url" varchar,
  	"version_image_id" uuid,
  	"version_source_image_url" varchar,
  	"version_is_free" boolean,
  	"version_price" numeric,
  	"version_currency" varchar,
  	"version_free_food" "enum__events_v_version_free_food" DEFAULT 'unknown',
  	"version_food_details" varchar,
  	"version_food_evidence" jsonb,
  	"version_event_status" "enum__events_v_version_event_status" DEFAULT 'scheduled',
  	"version_featured" boolean DEFAULT false,
  	"version_last_verified_at" timestamp(3) with time zone,
  	"version_critical_update_pending_since" timestamp(3) with time zone,
  	"version_source_excerpt" varchar,
  	"version_seo_title" varchar,
  	"version_seo_description" varchar,
  	"version_seo_image_id" uuid,
  	"version_seo_no_index" boolean DEFAULT false,
  	"version_review_status" "enum__events_v_version_review_status" DEFAULT 'needs_review',
  	"version_source_bot" varchar,
  	"version_external_id" varchar,
  	"version_has_pending_updates" boolean DEFAULT false,
  	"version_human_edited_fields" jsonb,
  	"version_review_notes" varchar,
  	"version_ai_provenance_generated_by_a_i" boolean DEFAULT false,
  	"version_ai_provenance_generator" varchar,
  	"version_ai_provenance_model" varchar,
  	"version_ai_provenance_generated_at" timestamp(3) with time zone,
  	"version_ai_provenance_notes" varchar,
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"version__status" "enum__events_v_version_status" DEFAULT 'draft',
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"latest" boolean
  );
  
  CREATE TABLE "_events_v_texts" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer NOT NULL,
  	"parent_id" uuid NOT NULL,
  	"path" varchar NOT NULL,
  	"text" varchar
  );
  
  CREATE TABLE "articles_source_references" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"title" varchar,
  	"url" varchar,
  	"publisher" varchar,
  	"accessed_at" timestamp(3) with time zone,
  	"source_id" uuid
  );
  
  CREATE TABLE "articles" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"title" varchar,
  	"slug" varchar,
  	"excerpt" varchar,
  	"content" jsonb,
  	"cover_image_id" uuid,
  	"author" varchar,
  	"publish_at" timestamp(3) with time zone,
  	"seo_title" varchar,
  	"seo_description" varchar,
  	"seo_image_id" uuid,
  	"seo_no_index" boolean DEFAULT false,
  	"review_status" "enum_articles_review_status" DEFAULT 'needs_review',
  	"published_at" timestamp(3) with time zone,
  	"source_bot" varchar,
  	"external_id" varchar,
  	"has_pending_updates" boolean DEFAULT false,
  	"human_edited_fields" jsonb,
  	"review_notes" varchar,
  	"ai_provenance_generated_by_a_i" boolean DEFAULT false,
  	"ai_provenance_generator" varchar,
  	"ai_provenance_model" varchar,
  	"ai_provenance_generated_at" timestamp(3) with time zone,
  	"ai_provenance_notes" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"_status" "enum_articles_status" DEFAULT 'draft'
  );
  
  CREATE TABLE "articles_texts" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer NOT NULL,
  	"parent_id" uuid NOT NULL,
  	"path" varchar NOT NULL,
  	"text" varchar
  );
  
  CREATE TABLE "_articles_v_version_source_references" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"title" varchar,
  	"url" varchar,
  	"publisher" varchar,
  	"accessed_at" timestamp(3) with time zone,
  	"source_id" uuid,
  	"_uuid" varchar
  );
  
  CREATE TABLE "_articles_v" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"parent_id" uuid,
  	"version_title" varchar,
  	"version_slug" varchar,
  	"version_excerpt" varchar,
  	"version_content" jsonb,
  	"version_cover_image_id" uuid,
  	"version_author" varchar,
  	"version_publish_at" timestamp(3) with time zone,
  	"version_seo_title" varchar,
  	"version_seo_description" varchar,
  	"version_seo_image_id" uuid,
  	"version_seo_no_index" boolean DEFAULT false,
  	"version_review_status" "enum__articles_v_version_review_status" DEFAULT 'needs_review',
  	"version_published_at" timestamp(3) with time zone,
  	"version_source_bot" varchar,
  	"version_external_id" varchar,
  	"version_has_pending_updates" boolean DEFAULT false,
  	"version_human_edited_fields" jsonb,
  	"version_review_notes" varchar,
  	"version_ai_provenance_generated_by_a_i" boolean DEFAULT false,
  	"version_ai_provenance_generator" varchar,
  	"version_ai_provenance_model" varchar,
  	"version_ai_provenance_generated_at" timestamp(3) with time zone,
  	"version_ai_provenance_notes" varchar,
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"version__status" "enum__articles_v_version_status" DEFAULT 'draft',
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"latest" boolean
  );
  
  CREATE TABLE "_articles_v_texts" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer NOT NULL,
  	"parent_id" uuid NOT NULL,
  	"path" varchar NOT NULL,
  	"text" varchar
  );
  
  CREATE TABLE "news_source_references" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"title" varchar,
  	"url" varchar,
  	"publisher" varchar,
  	"accessed_at" timestamp(3) with time zone,
  	"source_id" uuid
  );
  
  CREATE TABLE "news" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"title" varchar,
  	"slug" varchar,
  	"summary" varchar,
  	"body" jsonb,
  	"original_url" varchar,
  	"publisher" varchar,
  	"original_published_at" timestamp(3) with time zone,
  	"category" varchar,
  	"publish_at" timestamp(3) with time zone,
  	"review_status" "enum_news_review_status" DEFAULT 'needs_review',
  	"published_at" timestamp(3) with time zone,
  	"source_bot" varchar,
  	"external_id" varchar,
  	"has_pending_updates" boolean DEFAULT false,
  	"human_edited_fields" jsonb,
  	"review_notes" varchar,
  	"ai_provenance_generated_by_a_i" boolean DEFAULT false,
  	"ai_provenance_generator" varchar,
  	"ai_provenance_model" varchar,
  	"ai_provenance_generated_at" timestamp(3) with time zone,
  	"ai_provenance_notes" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"_status" "enum_news_status" DEFAULT 'draft'
  );
  
  CREATE TABLE "news_texts" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer NOT NULL,
  	"parent_id" uuid NOT NULL,
  	"path" varchar NOT NULL,
  	"text" varchar
  );
  
  CREATE TABLE "_news_v_version_source_references" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"title" varchar,
  	"url" varchar,
  	"publisher" varchar,
  	"accessed_at" timestamp(3) with time zone,
  	"source_id" uuid,
  	"_uuid" varchar
  );
  
  CREATE TABLE "_news_v" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"parent_id" uuid,
  	"version_title" varchar,
  	"version_slug" varchar,
  	"version_summary" varchar,
  	"version_body" jsonb,
  	"version_original_url" varchar,
  	"version_publisher" varchar,
  	"version_original_published_at" timestamp(3) with time zone,
  	"version_category" varchar,
  	"version_publish_at" timestamp(3) with time zone,
  	"version_review_status" "enum__news_v_version_review_status" DEFAULT 'needs_review',
  	"version_published_at" timestamp(3) with time zone,
  	"version_source_bot" varchar,
  	"version_external_id" varchar,
  	"version_has_pending_updates" boolean DEFAULT false,
  	"version_human_edited_fields" jsonb,
  	"version_review_notes" varchar,
  	"version_ai_provenance_generated_by_a_i" boolean DEFAULT false,
  	"version_ai_provenance_generator" varchar,
  	"version_ai_provenance_model" varchar,
  	"version_ai_provenance_generated_at" timestamp(3) with time zone,
  	"version_ai_provenance_notes" varchar,
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"version__status" "enum__news_v_version_status" DEFAULT 'draft',
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"latest" boolean
  );
  
  CREATE TABLE "_news_v_texts" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer NOT NULL,
  	"parent_id" uuid NOT NULL,
  	"path" varchar NOT NULL,
  	"text" varchar
  );
  
  CREATE TABLE "publications_source_references" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"title" varchar,
  	"url" varchar,
  	"publisher" varchar,
  	"accessed_at" timestamp(3) with time zone,
  	"source_id" uuid
  );
  
  CREATE TABLE "publications" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"title" varchar,
  	"slug" varchar,
  	"abstract" varchar,
  	"ai_summary" varchar,
  	"doi" varchar,
  	"journal" varchar,
  	"publication_date" timestamp(3) with time zone,
  	"publication_url" varchar,
  	"publish_at" timestamp(3) with time zone,
  	"review_status" "enum_publications_review_status" DEFAULT 'needs_review',
  	"published_at" timestamp(3) with time zone,
  	"source_bot" varchar,
  	"external_id" varchar,
  	"has_pending_updates" boolean DEFAULT false,
  	"human_edited_fields" jsonb,
  	"review_notes" varchar,
  	"ai_provenance_generated_by_a_i" boolean DEFAULT false,
  	"ai_provenance_generator" varchar,
  	"ai_provenance_model" varchar,
  	"ai_provenance_generated_at" timestamp(3) with time zone,
  	"ai_provenance_notes" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"_status" "enum_publications_status" DEFAULT 'draft'
  );
  
  CREATE TABLE "publications_texts" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer NOT NULL,
  	"parent_id" uuid NOT NULL,
  	"path" varchar NOT NULL,
  	"text" varchar
  );
  
  CREATE TABLE "_publications_v_version_source_references" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"title" varchar,
  	"url" varchar,
  	"publisher" varchar,
  	"accessed_at" timestamp(3) with time zone,
  	"source_id" uuid,
  	"_uuid" varchar
  );
  
  CREATE TABLE "_publications_v" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"parent_id" uuid,
  	"version_title" varchar,
  	"version_slug" varchar,
  	"version_abstract" varchar,
  	"version_ai_summary" varchar,
  	"version_doi" varchar,
  	"version_journal" varchar,
  	"version_publication_date" timestamp(3) with time zone,
  	"version_publication_url" varchar,
  	"version_publish_at" timestamp(3) with time zone,
  	"version_review_status" "enum__publications_v_version_review_status" DEFAULT 'needs_review',
  	"version_published_at" timestamp(3) with time zone,
  	"version_source_bot" varchar,
  	"version_external_id" varchar,
  	"version_has_pending_updates" boolean DEFAULT false,
  	"version_human_edited_fields" jsonb,
  	"version_review_notes" varchar,
  	"version_ai_provenance_generated_by_a_i" boolean DEFAULT false,
  	"version_ai_provenance_generator" varchar,
  	"version_ai_provenance_model" varchar,
  	"version_ai_provenance_generated_at" timestamp(3) with time zone,
  	"version_ai_provenance_notes" varchar,
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"version__status" "enum__publications_v_version_status" DEFAULT 'draft',
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"latest" boolean
  );
  
  CREATE TABLE "_publications_v_texts" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer NOT NULL,
  	"parent_id" uuid NOT NULL,
  	"path" varchar NOT NULL,
  	"text" varchar
  );
  
  CREATE TABLE "social_posts_source_references" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"title" varchar,
  	"url" varchar,
  	"publisher" varchar,
  	"accessed_at" timestamp(3) with time zone,
  	"source_id" uuid
  );
  
  CREATE TABLE "social_posts" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"title" varchar,
  	"content" varchar,
  	"platform" "enum_social_posts_platform",
  	"post_type" "enum_social_posts_post_type",
  	"target_url" varchar,
  	"scheduled_for" timestamp(3) with time zone,
  	"publishing_status" "enum_social_posts_publishing_status" DEFAULT 'draft',
  	"external_post_id" varchar,
  	"external_post_url" varchar,
  	"review_status" "enum_social_posts_review_status" DEFAULT 'needs_review',
  	"source_bot" varchar,
  	"external_id" varchar,
  	"has_pending_updates" boolean DEFAULT false,
  	"human_edited_fields" jsonb,
  	"review_notes" varchar,
  	"ai_provenance_generated_by_a_i" boolean DEFAULT false,
  	"ai_provenance_generator" varchar,
  	"ai_provenance_model" varchar,
  	"ai_provenance_generated_at" timestamp(3) with time zone,
  	"ai_provenance_notes" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"_status" "enum_social_posts_status" DEFAULT 'draft'
  );
  
  CREATE TABLE "social_posts_texts" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer NOT NULL,
  	"parent_id" uuid NOT NULL,
  	"path" varchar NOT NULL,
  	"text" varchar
  );
  
  CREATE TABLE "social_posts_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" uuid NOT NULL,
  	"path" varchar NOT NULL,
  	"media_id" uuid,
  	"events_id" uuid,
  	"articles_id" uuid,
  	"news_id" uuid,
  	"publications_id" uuid
  );
  
  CREATE TABLE "_social_posts_v_version_source_references" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"title" varchar,
  	"url" varchar,
  	"publisher" varchar,
  	"accessed_at" timestamp(3) with time zone,
  	"source_id" uuid,
  	"_uuid" varchar
  );
  
  CREATE TABLE "_social_posts_v" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"parent_id" uuid,
  	"version_title" varchar,
  	"version_content" varchar,
  	"version_platform" "enum__social_posts_v_version_platform",
  	"version_post_type" "enum__social_posts_v_version_post_type",
  	"version_target_url" varchar,
  	"version_scheduled_for" timestamp(3) with time zone,
  	"version_publishing_status" "enum__social_posts_v_version_publishing_status" DEFAULT 'draft',
  	"version_external_post_id" varchar,
  	"version_external_post_url" varchar,
  	"version_review_status" "enum__social_posts_v_version_review_status" DEFAULT 'needs_review',
  	"version_source_bot" varchar,
  	"version_external_id" varchar,
  	"version_has_pending_updates" boolean DEFAULT false,
  	"version_human_edited_fields" jsonb,
  	"version_review_notes" varchar,
  	"version_ai_provenance_generated_by_a_i" boolean DEFAULT false,
  	"version_ai_provenance_generator" varchar,
  	"version_ai_provenance_model" varchar,
  	"version_ai_provenance_generated_at" timestamp(3) with time zone,
  	"version_ai_provenance_notes" varchar,
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"version__status" "enum__social_posts_v_version_status" DEFAULT 'draft',
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"latest" boolean
  );
  
  CREATE TABLE "_social_posts_v_texts" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer NOT NULL,
  	"parent_id" uuid NOT NULL,
  	"path" varchar NOT NULL,
  	"text" varchar
  );
  
  CREATE TABLE "_social_posts_v_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" uuid NOT NULL,
  	"path" varchar NOT NULL,
  	"media_id" uuid,
  	"events_id" uuid,
  	"articles_id" uuid,
  	"news_id" uuid,
  	"publications_id" uuid
  );
  
  CREATE TABLE "media" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"alt" varchar,
  	"caption" varchar,
  	"credit" varchar,
  	"license" varchar,
  	"usage_rights" "enum_media_usage_rights" DEFAULT 'unknown' NOT NULL,
  	"visibility" "enum_media_visibility" DEFAULT 'private' NOT NULL,
  	"original_source_url" varchar,
  	"internal_notes" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"url" varchar,
  	"thumbnail_u_r_l" varchar,
  	"filename" varchar,
  	"mime_type" varchar,
  	"filesize" numeric,
  	"width" numeric,
  	"height" numeric,
  	"focal_x" numeric,
  	"focal_y" numeric,
  	"sizes_thumbnail_url" varchar,
  	"sizes_thumbnail_width" numeric,
  	"sizes_thumbnail_height" numeric,
  	"sizes_thumbnail_mime_type" varchar,
  	"sizes_thumbnail_filesize" numeric,
  	"sizes_thumbnail_filename" varchar,
  	"sizes_card_url" varchar,
  	"sizes_card_width" numeric,
  	"sizes_card_height" numeric,
  	"sizes_card_mime_type" varchar,
  	"sizes_card_filesize" numeric,
  	"sizes_card_filename" varchar,
  	"sizes_hero_url" varchar,
  	"sizes_hero_width" numeric,
  	"sizes_hero_height" numeric,
  	"sizes_hero_mime_type" varchar,
  	"sizes_hero_filesize" numeric,
  	"sizes_hero_filename" varchar
  );
  
  CREATE TABLE "sources" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"title" varchar NOT NULL,
  	"url" varchar NOT NULL,
  	"domain" varchar,
  	"source_type" "enum_sources_source_type" DEFAULT 'website' NOT NULL,
  	"publisher" varchar,
  	"discovered_at" timestamp(3) with time zone,
  	"last_checked_at" timestamp(3) with time zone,
  	"usage_rights" "enum_sources_usage_rights" DEFAULT 'facts_only' NOT NULL,
  	"ingestion_blocked" boolean DEFAULT false,
  	"notes" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "ingestion_runs" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"bot_id" varchar NOT NULL,
  	"credential_key_id" varchar,
  	"target_collection" "enum_ingestion_runs_target_collection" NOT NULL,
  	"idempotency_key" varchar,
  	"request_id" varchar,
  	"started_at" timestamp(3) with time zone NOT NULL,
  	"completed_at" timestamp(3) with time zone,
  	"status" "enum_ingestion_runs_status" DEFAULT 'running' NOT NULL,
  	"received" numeric DEFAULT 0,
  	"created" numeric DEFAULT 0,
  	"updated" numeric DEFAULT 0,
  	"proposed" numeric DEFAULT 0,
  	"skipped" numeric DEFAULT 0,
  	"failed" numeric DEFAULT 0,
  	"results" jsonb,
  	"errors" jsonb,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "pending_updates_changes" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"field" varchar NOT NULL,
  	"current_preview" varchar,
  	"proposed_preview" varchar,
  	"proposed_value" jsonb,
  	"apply" boolean DEFAULT true
  );
  
  CREATE TABLE "pending_updates" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"title" varchar NOT NULL,
  	"target_collection" "enum_pending_updates_target_collection" NOT NULL,
  	"target_id" varchar NOT NULL,
  	"source_bot" varchar,
  	"status" "enum_pending_updates_status" DEFAULT 'pending' NOT NULL,
  	"severity" "enum_pending_updates_severity" DEFAULT 'normal' NOT NULL,
  	"auto_applied" jsonb,
  	"ingestion_run_id" uuid,
  	"editor_note" varchar,
  	"resolved_at" timestamp(3) with time zone,
  	"resolved_by" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "ingestion_records" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"identity" varchar NOT NULL,
  	"target_collection" "enum_ingestion_records_target_collection" NOT NULL,
  	"target_id" varchar NOT NULL,
  	"source_bot" varchar NOT NULL,
  	"external_id" varchar NOT NULL,
  	"snapshot" jsonb NOT NULL,
  	"snapshot_hash" varchar NOT NULL,
  	"first_seen_at" timestamp(3) with time zone NOT NULL,
  	"last_seen_at" timestamp(3) with time zone NOT NULL,
  	"last_changed_at" timestamp(3) with time zone NOT NULL,
  	"last_run_id" uuid,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "users_sessions" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"created_at" timestamp(3) with time zone,
  	"expires_at" timestamp(3) with time zone NOT NULL
  );
  
  CREATE TABLE "users" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"name" varchar,
  	"role" "enum_users_role" DEFAULT 'editor' NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"email" varchar NOT NULL,
  	"reset_password_token" varchar,
  	"reset_password_expiration" timestamp(3) with time zone,
  	"salt" varchar,
  	"hash" varchar,
  	"reset_password_requested_at" timestamp(3) with time zone,
  	"login_attempts" numeric DEFAULT 0,
  	"lock_until" timestamp(3) with time zone
  );
  
  CREATE TABLE "ingestion_clients_scopes" (
  	"order" integer NOT NULL,
  	"parent_id" uuid NOT NULL,
  	"value" "enum_ingestion_clients_scopes",
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL
  );
  
  CREATE TABLE "ingestion_clients" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"name" varchar NOT NULL,
  	"bot_id" varchar NOT NULL,
  	"key_id" varchar NOT NULL,
  	"secret_hash" varchar NOT NULL,
  	"active" boolean DEFAULT true,
  	"expires_at" timestamp(3) with time zone,
  	"last_used_at" timestamp(3) with time zone,
  	"notes" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "payload_kv" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"key" varchar NOT NULL,
  	"data" jsonb NOT NULL
  );
  
  CREATE TABLE "payload_jobs_log" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"executed_at" timestamp(3) with time zone NOT NULL,
  	"completed_at" timestamp(3) with time zone NOT NULL,
  	"task_slug" "enum_payload_jobs_log_task_slug" NOT NULL,
  	"task_i_d" varchar NOT NULL,
  	"input" jsonb,
  	"output" jsonb,
  	"state" "enum_payload_jobs_log_state" NOT NULL,
  	"error" jsonb
  );
  
  CREATE TABLE "payload_jobs" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"input" jsonb,
  	"completed_at" timestamp(3) with time zone,
  	"total_tried" numeric DEFAULT 0,
  	"has_error" boolean DEFAULT false,
  	"error" jsonb,
  	"task_slug" "enum_payload_jobs_task_slug",
  	"queue" varchar DEFAULT 'default',
  	"wait_until" timestamp(3) with time zone,
  	"processing" boolean DEFAULT false,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "payload_locked_documents" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"global_slug" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "payload_locked_documents_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" uuid NOT NULL,
  	"path" varchar NOT NULL,
  	"events_id" uuid,
  	"articles_id" uuid,
  	"news_id" uuid,
  	"publications_id" uuid,
  	"social_posts_id" uuid,
  	"media_id" uuid,
  	"sources_id" uuid,
  	"ingestion_runs_id" uuid,
  	"pending_updates_id" uuid,
  	"ingestion_records_id" uuid,
  	"users_id" uuid,
  	"ingestion_clients_id" uuid
  );
  
  CREATE TABLE "payload_preferences" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"key" varchar,
  	"value" jsonb,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "payload_preferences_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" uuid NOT NULL,
  	"path" varchar NOT NULL,
  	"users_id" uuid
  );
  
  CREATE TABLE "payload_migrations" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"name" varchar,
  	"batch" numeric,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "settings" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"site_name" varchar DEFAULT 'Vantuch Content Hub',
  	"corrections_contact_email" varchar,
  	"critical_update_grace_hours" numeric DEFAULT 48,
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );
  
  ALTER TABLE "events_source_references" ADD CONSTRAINT "events_source_references_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "events_source_references" ADD CONSTRAINT "events_source_references_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "events" ADD CONSTRAINT "events_image_id_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "events" ADD CONSTRAINT "events_seo_image_id_media_id_fk" FOREIGN KEY ("seo_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "events_texts" ADD CONSTRAINT "events_texts_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_events_v_version_source_references" ADD CONSTRAINT "_events_v_version_source_references_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_events_v_version_source_references" ADD CONSTRAINT "_events_v_version_source_references_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_events_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_events_v" ADD CONSTRAINT "_events_v_parent_id_events_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_events_v" ADD CONSTRAINT "_events_v_version_image_id_media_id_fk" FOREIGN KEY ("version_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_events_v" ADD CONSTRAINT "_events_v_version_seo_image_id_media_id_fk" FOREIGN KEY ("version_seo_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_events_v_texts" ADD CONSTRAINT "_events_v_texts_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."_events_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "articles_source_references" ADD CONSTRAINT "articles_source_references_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "articles_source_references" ADD CONSTRAINT "articles_source_references_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "articles" ADD CONSTRAINT "articles_cover_image_id_media_id_fk" FOREIGN KEY ("cover_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "articles" ADD CONSTRAINT "articles_seo_image_id_media_id_fk" FOREIGN KEY ("seo_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "articles_texts" ADD CONSTRAINT "articles_texts_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_articles_v_version_source_references" ADD CONSTRAINT "_articles_v_version_source_references_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_articles_v_version_source_references" ADD CONSTRAINT "_articles_v_version_source_references_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_articles_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_articles_v" ADD CONSTRAINT "_articles_v_parent_id_articles_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."articles"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_articles_v" ADD CONSTRAINT "_articles_v_version_cover_image_id_media_id_fk" FOREIGN KEY ("version_cover_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_articles_v" ADD CONSTRAINT "_articles_v_version_seo_image_id_media_id_fk" FOREIGN KEY ("version_seo_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_articles_v_texts" ADD CONSTRAINT "_articles_v_texts_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."_articles_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "news_source_references" ADD CONSTRAINT "news_source_references_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "news_source_references" ADD CONSTRAINT "news_source_references_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."news"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "news_texts" ADD CONSTRAINT "news_texts_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."news"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_news_v_version_source_references" ADD CONSTRAINT "_news_v_version_source_references_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_news_v_version_source_references" ADD CONSTRAINT "_news_v_version_source_references_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_news_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_news_v" ADD CONSTRAINT "_news_v_parent_id_news_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."news"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_news_v_texts" ADD CONSTRAINT "_news_v_texts_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."_news_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "publications_source_references" ADD CONSTRAINT "publications_source_references_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "publications_source_references" ADD CONSTRAINT "publications_source_references_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."publications"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "publications_texts" ADD CONSTRAINT "publications_texts_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."publications"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_publications_v_version_source_references" ADD CONSTRAINT "_publications_v_version_source_references_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_publications_v_version_source_references" ADD CONSTRAINT "_publications_v_version_source_references_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_publications_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_publications_v" ADD CONSTRAINT "_publications_v_parent_id_publications_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."publications"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_publications_v_texts" ADD CONSTRAINT "_publications_v_texts_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."_publications_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "social_posts_source_references" ADD CONSTRAINT "social_posts_source_references_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "social_posts_source_references" ADD CONSTRAINT "social_posts_source_references_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."social_posts"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "social_posts_texts" ADD CONSTRAINT "social_posts_texts_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."social_posts"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "social_posts_rels" ADD CONSTRAINT "social_posts_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."social_posts"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "social_posts_rels" ADD CONSTRAINT "social_posts_rels_media_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "social_posts_rels" ADD CONSTRAINT "social_posts_rels_events_fk" FOREIGN KEY ("events_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "social_posts_rels" ADD CONSTRAINT "social_posts_rels_articles_fk" FOREIGN KEY ("articles_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "social_posts_rels" ADD CONSTRAINT "social_posts_rels_news_fk" FOREIGN KEY ("news_id") REFERENCES "public"."news"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "social_posts_rels" ADD CONSTRAINT "social_posts_rels_publications_fk" FOREIGN KEY ("publications_id") REFERENCES "public"."publications"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_social_posts_v_version_source_references" ADD CONSTRAINT "_social_posts_v_version_source_references_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_social_posts_v_version_source_references" ADD CONSTRAINT "_social_posts_v_version_source_references_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_social_posts_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_social_posts_v" ADD CONSTRAINT "_social_posts_v_parent_id_social_posts_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."social_posts"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_social_posts_v_texts" ADD CONSTRAINT "_social_posts_v_texts_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."_social_posts_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_social_posts_v_rels" ADD CONSTRAINT "_social_posts_v_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."_social_posts_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_social_posts_v_rels" ADD CONSTRAINT "_social_posts_v_rels_media_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_social_posts_v_rels" ADD CONSTRAINT "_social_posts_v_rels_events_fk" FOREIGN KEY ("events_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_social_posts_v_rels" ADD CONSTRAINT "_social_posts_v_rels_articles_fk" FOREIGN KEY ("articles_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_social_posts_v_rels" ADD CONSTRAINT "_social_posts_v_rels_news_fk" FOREIGN KEY ("news_id") REFERENCES "public"."news"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_social_posts_v_rels" ADD CONSTRAINT "_social_posts_v_rels_publications_fk" FOREIGN KEY ("publications_id") REFERENCES "public"."publications"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "pending_updates_changes" ADD CONSTRAINT "pending_updates_changes_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."pending_updates"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "pending_updates" ADD CONSTRAINT "pending_updates_ingestion_run_id_ingestion_runs_id_fk" FOREIGN KEY ("ingestion_run_id") REFERENCES "public"."ingestion_runs"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "ingestion_records" ADD CONSTRAINT "ingestion_records_last_run_id_ingestion_runs_id_fk" FOREIGN KEY ("last_run_id") REFERENCES "public"."ingestion_runs"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "users_sessions" ADD CONSTRAINT "users_sessions_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "ingestion_clients_scopes" ADD CONSTRAINT "ingestion_clients_scopes_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."ingestion_clients"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_jobs_log" ADD CONSTRAINT "payload_jobs_log_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."payload_jobs"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."payload_locked_documents"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_events_fk" FOREIGN KEY ("events_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_articles_fk" FOREIGN KEY ("articles_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_news_fk" FOREIGN KEY ("news_id") REFERENCES "public"."news"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_publications_fk" FOREIGN KEY ("publications_id") REFERENCES "public"."publications"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_social_posts_fk" FOREIGN KEY ("social_posts_id") REFERENCES "public"."social_posts"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_media_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_sources_fk" FOREIGN KEY ("sources_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_ingestion_runs_fk" FOREIGN KEY ("ingestion_runs_id") REFERENCES "public"."ingestion_runs"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_pending_updates_fk" FOREIGN KEY ("pending_updates_id") REFERENCES "public"."pending_updates"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_ingestion_records_fk" FOREIGN KEY ("ingestion_records_id") REFERENCES "public"."ingestion_records"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_ingestion_clients_fk" FOREIGN KEY ("ingestion_clients_id") REFERENCES "public"."ingestion_clients"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_preferences_rels" ADD CONSTRAINT "payload_preferences_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."payload_preferences"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_preferences_rels" ADD CONSTRAINT "payload_preferences_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "events_source_references_order_idx" ON "events_source_references" USING btree ("_order");
  CREATE INDEX "events_source_references_parent_id_idx" ON "events_source_references" USING btree ("_parent_id");
  CREATE INDEX "events_source_references_source_idx" ON "events_source_references" USING btree ("source_id");
  CREATE UNIQUE INDEX "events_slug_idx" ON "events" USING btree ("slug");
  CREATE INDEX "events_starts_at_idx" ON "events" USING btree ("starts_at");
  CREATE INDEX "events_city_slug_idx" ON "events" USING btree ("city_slug");
  CREATE INDEX "events_category_idx" ON "events" USING btree ("category");
  CREATE INDEX "events_image_idx" ON "events" USING btree ("image_id");
  CREATE INDEX "events_free_food_idx" ON "events" USING btree ("free_food");
  CREATE INDEX "events_event_status_idx" ON "events" USING btree ("event_status");
  CREATE INDEX "events_featured_idx" ON "events" USING btree ("featured");
  CREATE INDEX "events_critical_update_pending_since_idx" ON "events" USING btree ("critical_update_pending_since");
  CREATE INDEX "events_seo_seo_image_idx" ON "events" USING btree ("seo_image_id");
  CREATE INDEX "events_review_status_idx" ON "events" USING btree ("review_status");
  CREATE INDEX "events_source_bot_idx" ON "events" USING btree ("source_bot");
  CREATE INDEX "events_has_pending_updates_idx" ON "events" USING btree ("has_pending_updates");
  CREATE INDEX "events_updated_at_idx" ON "events" USING btree ("updated_at");
  CREATE INDEX "events_created_at_idx" ON "events" USING btree ("created_at");
  CREATE INDEX "events__status_idx" ON "events" USING btree ("_status");
  CREATE INDEX "citySlug_startsAt_idx" ON "events" USING btree ("city_slug","starts_at");
  CREATE INDEX "category_startsAt_idx" ON "events" USING btree ("category","starts_at");
  CREATE INDEX "reviewStatus_startsAt_idx" ON "events" USING btree ("review_status","starts_at");
  CREATE INDEX "events_texts_order_parent" ON "events_texts" USING btree ("order","parent_id");
  CREATE INDEX "_events_v_version_source_references_order_idx" ON "_events_v_version_source_references" USING btree ("_order");
  CREATE INDEX "_events_v_version_source_references_parent_id_idx" ON "_events_v_version_source_references" USING btree ("_parent_id");
  CREATE INDEX "_events_v_version_source_references_source_idx" ON "_events_v_version_source_references" USING btree ("source_id");
  CREATE INDEX "_events_v_parent_idx" ON "_events_v" USING btree ("parent_id");
  CREATE INDEX "_events_v_version_version_slug_idx" ON "_events_v" USING btree ("version_slug");
  CREATE INDEX "_events_v_version_version_starts_at_idx" ON "_events_v" USING btree ("version_starts_at");
  CREATE INDEX "_events_v_version_version_city_slug_idx" ON "_events_v" USING btree ("version_city_slug");
  CREATE INDEX "_events_v_version_version_category_idx" ON "_events_v" USING btree ("version_category");
  CREATE INDEX "_events_v_version_version_image_idx" ON "_events_v" USING btree ("version_image_id");
  CREATE INDEX "_events_v_version_version_free_food_idx" ON "_events_v" USING btree ("version_free_food");
  CREATE INDEX "_events_v_version_version_event_status_idx" ON "_events_v" USING btree ("version_event_status");
  CREATE INDEX "_events_v_version_version_featured_idx" ON "_events_v" USING btree ("version_featured");
  CREATE INDEX "_events_v_version_version_critical_update_pending_since_idx" ON "_events_v" USING btree ("version_critical_update_pending_since");
  CREATE INDEX "_events_v_version_seo_version_seo_image_idx" ON "_events_v" USING btree ("version_seo_image_id");
  CREATE INDEX "_events_v_version_version_review_status_idx" ON "_events_v" USING btree ("version_review_status");
  CREATE INDEX "_events_v_version_version_source_bot_idx" ON "_events_v" USING btree ("version_source_bot");
  CREATE INDEX "_events_v_version_version_has_pending_updates_idx" ON "_events_v" USING btree ("version_has_pending_updates");
  CREATE INDEX "_events_v_version_version_updated_at_idx" ON "_events_v" USING btree ("version_updated_at");
  CREATE INDEX "_events_v_version_version_created_at_idx" ON "_events_v" USING btree ("version_created_at");
  CREATE INDEX "_events_v_version_version__status_idx" ON "_events_v" USING btree ("version__status");
  CREATE INDEX "_events_v_created_at_idx" ON "_events_v" USING btree ("created_at");
  CREATE INDEX "_events_v_updated_at_idx" ON "_events_v" USING btree ("updated_at");
  CREATE INDEX "_events_v_latest_idx" ON "_events_v" USING btree ("latest");
  CREATE INDEX "version_citySlug_version_startsAt_idx" ON "_events_v" USING btree ("version_city_slug","version_starts_at");
  CREATE INDEX "version_category_version_startsAt_idx" ON "_events_v" USING btree ("version_category","version_starts_at");
  CREATE INDEX "version_reviewStatus_version_startsAt_idx" ON "_events_v" USING btree ("version_review_status","version_starts_at");
  CREATE INDEX "_events_v_texts_order_parent" ON "_events_v_texts" USING btree ("order","parent_id");
  CREATE INDEX "articles_source_references_order_idx" ON "articles_source_references" USING btree ("_order");
  CREATE INDEX "articles_source_references_parent_id_idx" ON "articles_source_references" USING btree ("_parent_id");
  CREATE INDEX "articles_source_references_source_idx" ON "articles_source_references" USING btree ("source_id");
  CREATE UNIQUE INDEX "articles_slug_idx" ON "articles" USING btree ("slug");
  CREATE INDEX "articles_cover_image_idx" ON "articles" USING btree ("cover_image_id");
  CREATE INDEX "articles_publish_at_idx" ON "articles" USING btree ("publish_at");
  CREATE INDEX "articles_seo_seo_image_idx" ON "articles" USING btree ("seo_image_id");
  CREATE INDEX "articles_review_status_idx" ON "articles" USING btree ("review_status");
  CREATE INDEX "articles_published_at_idx" ON "articles" USING btree ("published_at");
  CREATE INDEX "articles_source_bot_idx" ON "articles" USING btree ("source_bot");
  CREATE INDEX "articles_has_pending_updates_idx" ON "articles" USING btree ("has_pending_updates");
  CREATE INDEX "articles_updated_at_idx" ON "articles" USING btree ("updated_at");
  CREATE INDEX "articles_created_at_idx" ON "articles" USING btree ("created_at");
  CREATE INDEX "articles__status_idx" ON "articles" USING btree ("_status");
  CREATE INDEX "articles_texts_order_parent" ON "articles_texts" USING btree ("order","parent_id");
  CREATE INDEX "_articles_v_version_source_references_order_idx" ON "_articles_v_version_source_references" USING btree ("_order");
  CREATE INDEX "_articles_v_version_source_references_parent_id_idx" ON "_articles_v_version_source_references" USING btree ("_parent_id");
  CREATE INDEX "_articles_v_version_source_references_source_idx" ON "_articles_v_version_source_references" USING btree ("source_id");
  CREATE INDEX "_articles_v_parent_idx" ON "_articles_v" USING btree ("parent_id");
  CREATE INDEX "_articles_v_version_version_slug_idx" ON "_articles_v" USING btree ("version_slug");
  CREATE INDEX "_articles_v_version_version_cover_image_idx" ON "_articles_v" USING btree ("version_cover_image_id");
  CREATE INDEX "_articles_v_version_version_publish_at_idx" ON "_articles_v" USING btree ("version_publish_at");
  CREATE INDEX "_articles_v_version_seo_version_seo_image_idx" ON "_articles_v" USING btree ("version_seo_image_id");
  CREATE INDEX "_articles_v_version_version_review_status_idx" ON "_articles_v" USING btree ("version_review_status");
  CREATE INDEX "_articles_v_version_version_published_at_idx" ON "_articles_v" USING btree ("version_published_at");
  CREATE INDEX "_articles_v_version_version_source_bot_idx" ON "_articles_v" USING btree ("version_source_bot");
  CREATE INDEX "_articles_v_version_version_has_pending_updates_idx" ON "_articles_v" USING btree ("version_has_pending_updates");
  CREATE INDEX "_articles_v_version_version_updated_at_idx" ON "_articles_v" USING btree ("version_updated_at");
  CREATE INDEX "_articles_v_version_version_created_at_idx" ON "_articles_v" USING btree ("version_created_at");
  CREATE INDEX "_articles_v_version_version__status_idx" ON "_articles_v" USING btree ("version__status");
  CREATE INDEX "_articles_v_created_at_idx" ON "_articles_v" USING btree ("created_at");
  CREATE INDEX "_articles_v_updated_at_idx" ON "_articles_v" USING btree ("updated_at");
  CREATE INDEX "_articles_v_latest_idx" ON "_articles_v" USING btree ("latest");
  CREATE INDEX "_articles_v_texts_order_parent" ON "_articles_v_texts" USING btree ("order","parent_id");
  CREATE INDEX "news_source_references_order_idx" ON "news_source_references" USING btree ("_order");
  CREATE INDEX "news_source_references_parent_id_idx" ON "news_source_references" USING btree ("_parent_id");
  CREATE INDEX "news_source_references_source_idx" ON "news_source_references" USING btree ("source_id");
  CREATE UNIQUE INDEX "news_slug_idx" ON "news" USING btree ("slug");
  CREATE INDEX "news_original_published_at_idx" ON "news" USING btree ("original_published_at");
  CREATE INDEX "news_category_idx" ON "news" USING btree ("category");
  CREATE INDEX "news_publish_at_idx" ON "news" USING btree ("publish_at");
  CREATE INDEX "news_review_status_idx" ON "news" USING btree ("review_status");
  CREATE INDEX "news_published_at_idx" ON "news" USING btree ("published_at");
  CREATE INDEX "news_source_bot_idx" ON "news" USING btree ("source_bot");
  CREATE INDEX "news_has_pending_updates_idx" ON "news" USING btree ("has_pending_updates");
  CREATE INDEX "news_updated_at_idx" ON "news" USING btree ("updated_at");
  CREATE INDEX "news_created_at_idx" ON "news" USING btree ("created_at");
  CREATE INDEX "news__status_idx" ON "news" USING btree ("_status");
  CREATE INDEX "news_texts_order_parent" ON "news_texts" USING btree ("order","parent_id");
  CREATE INDEX "_news_v_version_source_references_order_idx" ON "_news_v_version_source_references" USING btree ("_order");
  CREATE INDEX "_news_v_version_source_references_parent_id_idx" ON "_news_v_version_source_references" USING btree ("_parent_id");
  CREATE INDEX "_news_v_version_source_references_source_idx" ON "_news_v_version_source_references" USING btree ("source_id");
  CREATE INDEX "_news_v_parent_idx" ON "_news_v" USING btree ("parent_id");
  CREATE INDEX "_news_v_version_version_slug_idx" ON "_news_v" USING btree ("version_slug");
  CREATE INDEX "_news_v_version_version_original_published_at_idx" ON "_news_v" USING btree ("version_original_published_at");
  CREATE INDEX "_news_v_version_version_category_idx" ON "_news_v" USING btree ("version_category");
  CREATE INDEX "_news_v_version_version_publish_at_idx" ON "_news_v" USING btree ("version_publish_at");
  CREATE INDEX "_news_v_version_version_review_status_idx" ON "_news_v" USING btree ("version_review_status");
  CREATE INDEX "_news_v_version_version_published_at_idx" ON "_news_v" USING btree ("version_published_at");
  CREATE INDEX "_news_v_version_version_source_bot_idx" ON "_news_v" USING btree ("version_source_bot");
  CREATE INDEX "_news_v_version_version_has_pending_updates_idx" ON "_news_v" USING btree ("version_has_pending_updates");
  CREATE INDEX "_news_v_version_version_updated_at_idx" ON "_news_v" USING btree ("version_updated_at");
  CREATE INDEX "_news_v_version_version_created_at_idx" ON "_news_v" USING btree ("version_created_at");
  CREATE INDEX "_news_v_version_version__status_idx" ON "_news_v" USING btree ("version__status");
  CREATE INDEX "_news_v_created_at_idx" ON "_news_v" USING btree ("created_at");
  CREATE INDEX "_news_v_updated_at_idx" ON "_news_v" USING btree ("updated_at");
  CREATE INDEX "_news_v_latest_idx" ON "_news_v" USING btree ("latest");
  CREATE INDEX "_news_v_texts_order_parent" ON "_news_v_texts" USING btree ("order","parent_id");
  CREATE INDEX "publications_source_references_order_idx" ON "publications_source_references" USING btree ("_order");
  CREATE INDEX "publications_source_references_parent_id_idx" ON "publications_source_references" USING btree ("_parent_id");
  CREATE INDEX "publications_source_references_source_idx" ON "publications_source_references" USING btree ("source_id");
  CREATE UNIQUE INDEX "publications_slug_idx" ON "publications" USING btree ("slug");
  CREATE INDEX "publications_doi_idx" ON "publications" USING btree ("doi");
  CREATE INDEX "publications_publication_date_idx" ON "publications" USING btree ("publication_date");
  CREATE INDEX "publications_publish_at_idx" ON "publications" USING btree ("publish_at");
  CREATE INDEX "publications_review_status_idx" ON "publications" USING btree ("review_status");
  CREATE INDEX "publications_published_at_idx" ON "publications" USING btree ("published_at");
  CREATE INDEX "publications_source_bot_idx" ON "publications" USING btree ("source_bot");
  CREATE INDEX "publications_has_pending_updates_idx" ON "publications" USING btree ("has_pending_updates");
  CREATE INDEX "publications_updated_at_idx" ON "publications" USING btree ("updated_at");
  CREATE INDEX "publications_created_at_idx" ON "publications" USING btree ("created_at");
  CREATE INDEX "publications__status_idx" ON "publications" USING btree ("_status");
  CREATE INDEX "publications_texts_order_parent" ON "publications_texts" USING btree ("order","parent_id");
  CREATE INDEX "_publications_v_version_source_references_order_idx" ON "_publications_v_version_source_references" USING btree ("_order");
  CREATE INDEX "_publications_v_version_source_references_parent_id_idx" ON "_publications_v_version_source_references" USING btree ("_parent_id");
  CREATE INDEX "_publications_v_version_source_references_source_idx" ON "_publications_v_version_source_references" USING btree ("source_id");
  CREATE INDEX "_publications_v_parent_idx" ON "_publications_v" USING btree ("parent_id");
  CREATE INDEX "_publications_v_version_version_slug_idx" ON "_publications_v" USING btree ("version_slug");
  CREATE INDEX "_publications_v_version_version_doi_idx" ON "_publications_v" USING btree ("version_doi");
  CREATE INDEX "_publications_v_version_version_publication_date_idx" ON "_publications_v" USING btree ("version_publication_date");
  CREATE INDEX "_publications_v_version_version_publish_at_idx" ON "_publications_v" USING btree ("version_publish_at");
  CREATE INDEX "_publications_v_version_version_review_status_idx" ON "_publications_v" USING btree ("version_review_status");
  CREATE INDEX "_publications_v_version_version_published_at_idx" ON "_publications_v" USING btree ("version_published_at");
  CREATE INDEX "_publications_v_version_version_source_bot_idx" ON "_publications_v" USING btree ("version_source_bot");
  CREATE INDEX "_publications_v_version_version_has_pending_updates_idx" ON "_publications_v" USING btree ("version_has_pending_updates");
  CREATE INDEX "_publications_v_version_version_updated_at_idx" ON "_publications_v" USING btree ("version_updated_at");
  CREATE INDEX "_publications_v_version_version_created_at_idx" ON "_publications_v" USING btree ("version_created_at");
  CREATE INDEX "_publications_v_version_version__status_idx" ON "_publications_v" USING btree ("version__status");
  CREATE INDEX "_publications_v_created_at_idx" ON "_publications_v" USING btree ("created_at");
  CREATE INDEX "_publications_v_updated_at_idx" ON "_publications_v" USING btree ("updated_at");
  CREATE INDEX "_publications_v_latest_idx" ON "_publications_v" USING btree ("latest");
  CREATE INDEX "_publications_v_texts_order_parent" ON "_publications_v_texts" USING btree ("order","parent_id");
  CREATE INDEX "social_posts_source_references_order_idx" ON "social_posts_source_references" USING btree ("_order");
  CREATE INDEX "social_posts_source_references_parent_id_idx" ON "social_posts_source_references" USING btree ("_parent_id");
  CREATE INDEX "social_posts_source_references_source_idx" ON "social_posts_source_references" USING btree ("source_id");
  CREATE INDEX "social_posts_platform_idx" ON "social_posts" USING btree ("platform");
  CREATE INDEX "social_posts_scheduled_for_idx" ON "social_posts" USING btree ("scheduled_for");
  CREATE INDEX "social_posts_publishing_status_idx" ON "social_posts" USING btree ("publishing_status");
  CREATE INDEX "social_posts_review_status_idx" ON "social_posts" USING btree ("review_status");
  CREATE INDEX "social_posts_source_bot_idx" ON "social_posts" USING btree ("source_bot");
  CREATE INDEX "social_posts_has_pending_updates_idx" ON "social_posts" USING btree ("has_pending_updates");
  CREATE INDEX "social_posts_updated_at_idx" ON "social_posts" USING btree ("updated_at");
  CREATE INDEX "social_posts_created_at_idx" ON "social_posts" USING btree ("created_at");
  CREATE INDEX "social_posts__status_idx" ON "social_posts" USING btree ("_status");
  CREATE INDEX "social_posts_texts_order_parent" ON "social_posts_texts" USING btree ("order","parent_id");
  CREATE INDEX "social_posts_rels_order_idx" ON "social_posts_rels" USING btree ("order");
  CREATE INDEX "social_posts_rels_parent_idx" ON "social_posts_rels" USING btree ("parent_id");
  CREATE INDEX "social_posts_rels_path_idx" ON "social_posts_rels" USING btree ("path");
  CREATE INDEX "social_posts_rels_media_id_idx" ON "social_posts_rels" USING btree ("media_id");
  CREATE INDEX "social_posts_rels_events_id_idx" ON "social_posts_rels" USING btree ("events_id");
  CREATE INDEX "social_posts_rels_articles_id_idx" ON "social_posts_rels" USING btree ("articles_id");
  CREATE INDEX "social_posts_rels_news_id_idx" ON "social_posts_rels" USING btree ("news_id");
  CREATE INDEX "social_posts_rels_publications_id_idx" ON "social_posts_rels" USING btree ("publications_id");
  CREATE INDEX "_social_posts_v_version_source_references_order_idx" ON "_social_posts_v_version_source_references" USING btree ("_order");
  CREATE INDEX "_social_posts_v_version_source_references_parent_id_idx" ON "_social_posts_v_version_source_references" USING btree ("_parent_id");
  CREATE INDEX "_social_posts_v_version_source_references_source_idx" ON "_social_posts_v_version_source_references" USING btree ("source_id");
  CREATE INDEX "_social_posts_v_parent_idx" ON "_social_posts_v" USING btree ("parent_id");
  CREATE INDEX "_social_posts_v_version_version_platform_idx" ON "_social_posts_v" USING btree ("version_platform");
  CREATE INDEX "_social_posts_v_version_version_scheduled_for_idx" ON "_social_posts_v" USING btree ("version_scheduled_for");
  CREATE INDEX "_social_posts_v_version_version_publishing_status_idx" ON "_social_posts_v" USING btree ("version_publishing_status");
  CREATE INDEX "_social_posts_v_version_version_review_status_idx" ON "_social_posts_v" USING btree ("version_review_status");
  CREATE INDEX "_social_posts_v_version_version_source_bot_idx" ON "_social_posts_v" USING btree ("version_source_bot");
  CREATE INDEX "_social_posts_v_version_version_has_pending_updates_idx" ON "_social_posts_v" USING btree ("version_has_pending_updates");
  CREATE INDEX "_social_posts_v_version_version_updated_at_idx" ON "_social_posts_v" USING btree ("version_updated_at");
  CREATE INDEX "_social_posts_v_version_version_created_at_idx" ON "_social_posts_v" USING btree ("version_created_at");
  CREATE INDEX "_social_posts_v_version_version__status_idx" ON "_social_posts_v" USING btree ("version__status");
  CREATE INDEX "_social_posts_v_created_at_idx" ON "_social_posts_v" USING btree ("created_at");
  CREATE INDEX "_social_posts_v_updated_at_idx" ON "_social_posts_v" USING btree ("updated_at");
  CREATE INDEX "_social_posts_v_latest_idx" ON "_social_posts_v" USING btree ("latest");
  CREATE INDEX "_social_posts_v_texts_order_parent" ON "_social_posts_v_texts" USING btree ("order","parent_id");
  CREATE INDEX "_social_posts_v_rels_order_idx" ON "_social_posts_v_rels" USING btree ("order");
  CREATE INDEX "_social_posts_v_rels_parent_idx" ON "_social_posts_v_rels" USING btree ("parent_id");
  CREATE INDEX "_social_posts_v_rels_path_idx" ON "_social_posts_v_rels" USING btree ("path");
  CREATE INDEX "_social_posts_v_rels_media_id_idx" ON "_social_posts_v_rels" USING btree ("media_id");
  CREATE INDEX "_social_posts_v_rels_events_id_idx" ON "_social_posts_v_rels" USING btree ("events_id");
  CREATE INDEX "_social_posts_v_rels_articles_id_idx" ON "_social_posts_v_rels" USING btree ("articles_id");
  CREATE INDEX "_social_posts_v_rels_news_id_idx" ON "_social_posts_v_rels" USING btree ("news_id");
  CREATE INDEX "_social_posts_v_rels_publications_id_idx" ON "_social_posts_v_rels" USING btree ("publications_id");
  CREATE INDEX "media_visibility_idx" ON "media" USING btree ("visibility");
  CREATE INDEX "media_updated_at_idx" ON "media" USING btree ("updated_at");
  CREATE INDEX "media_created_at_idx" ON "media" USING btree ("created_at");
  CREATE UNIQUE INDEX "media_filename_idx" ON "media" USING btree ("filename");
  CREATE INDEX "media_sizes_thumbnail_sizes_thumbnail_filename_idx" ON "media" USING btree ("sizes_thumbnail_filename");
  CREATE INDEX "media_sizes_card_sizes_card_filename_idx" ON "media" USING btree ("sizes_card_filename");
  CREATE INDEX "media_sizes_hero_sizes_hero_filename_idx" ON "media" USING btree ("sizes_hero_filename");
  CREATE UNIQUE INDEX "sources_url_idx" ON "sources" USING btree ("url");
  CREATE INDEX "sources_domain_idx" ON "sources" USING btree ("domain");
  CREATE INDEX "sources_ingestion_blocked_idx" ON "sources" USING btree ("ingestion_blocked");
  CREATE INDEX "sources_updated_at_idx" ON "sources" USING btree ("updated_at");
  CREATE INDEX "sources_created_at_idx" ON "sources" USING btree ("created_at");
  CREATE INDEX "ingestion_runs_bot_id_idx" ON "ingestion_runs" USING btree ("bot_id");
  CREATE INDEX "ingestion_runs_started_at_idx" ON "ingestion_runs" USING btree ("started_at");
  CREATE INDEX "ingestion_runs_status_idx" ON "ingestion_runs" USING btree ("status");
  CREATE INDEX "ingestion_runs_updated_at_idx" ON "ingestion_runs" USING btree ("updated_at");
  CREATE INDEX "ingestion_runs_created_at_idx" ON "ingestion_runs" USING btree ("created_at");
  CREATE UNIQUE INDEX "botId_idempotencyKey_idx" ON "ingestion_runs" USING btree ("bot_id","idempotency_key");
  CREATE INDEX "pending_updates_changes_order_idx" ON "pending_updates_changes" USING btree ("_order");
  CREATE INDEX "pending_updates_changes_parent_id_idx" ON "pending_updates_changes" USING btree ("_parent_id");
  CREATE INDEX "pending_updates_target_collection_idx" ON "pending_updates" USING btree ("target_collection");
  CREATE INDEX "pending_updates_target_id_idx" ON "pending_updates" USING btree ("target_id");
  CREATE INDEX "pending_updates_source_bot_idx" ON "pending_updates" USING btree ("source_bot");
  CREATE INDEX "pending_updates_status_idx" ON "pending_updates" USING btree ("status");
  CREATE INDEX "pending_updates_severity_idx" ON "pending_updates" USING btree ("severity");
  CREATE INDEX "pending_updates_ingestion_run_idx" ON "pending_updates" USING btree ("ingestion_run_id");
  CREATE INDEX "pending_updates_updated_at_idx" ON "pending_updates" USING btree ("updated_at");
  CREATE INDEX "pending_updates_created_at_idx" ON "pending_updates" USING btree ("created_at");
  CREATE UNIQUE INDEX "ingestion_records_identity_idx" ON "ingestion_records" USING btree ("identity");
  CREATE INDEX "ingestion_records_target_collection_idx" ON "ingestion_records" USING btree ("target_collection");
  CREATE INDEX "ingestion_records_target_id_idx" ON "ingestion_records" USING btree ("target_id");
  CREATE INDEX "ingestion_records_source_bot_idx" ON "ingestion_records" USING btree ("source_bot");
  CREATE INDEX "ingestion_records_last_seen_at_idx" ON "ingestion_records" USING btree ("last_seen_at");
  CREATE INDEX "ingestion_records_last_run_idx" ON "ingestion_records" USING btree ("last_run_id");
  CREATE INDEX "ingestion_records_updated_at_idx" ON "ingestion_records" USING btree ("updated_at");
  CREATE INDEX "ingestion_records_created_at_idx" ON "ingestion_records" USING btree ("created_at");
  CREATE INDEX "users_sessions_order_idx" ON "users_sessions" USING btree ("_order");
  CREATE INDEX "users_sessions_parent_id_idx" ON "users_sessions" USING btree ("_parent_id");
  CREATE INDEX "users_updated_at_idx" ON "users" USING btree ("updated_at");
  CREATE INDEX "users_created_at_idx" ON "users" USING btree ("created_at");
  CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");
  CREATE INDEX "ingestion_clients_scopes_order_idx" ON "ingestion_clients_scopes" USING btree ("order");
  CREATE INDEX "ingestion_clients_scopes_parent_idx" ON "ingestion_clients_scopes" USING btree ("parent_id");
  CREATE INDEX "ingestion_clients_bot_id_idx" ON "ingestion_clients" USING btree ("bot_id");
  CREATE UNIQUE INDEX "ingestion_clients_key_id_idx" ON "ingestion_clients" USING btree ("key_id");
  CREATE INDEX "ingestion_clients_active_idx" ON "ingestion_clients" USING btree ("active");
  CREATE INDEX "ingestion_clients_updated_at_idx" ON "ingestion_clients" USING btree ("updated_at");
  CREATE INDEX "ingestion_clients_created_at_idx" ON "ingestion_clients" USING btree ("created_at");
  CREATE UNIQUE INDEX "payload_kv_key_idx" ON "payload_kv" USING btree ("key");
  CREATE INDEX "payload_jobs_log_order_idx" ON "payload_jobs_log" USING btree ("_order");
  CREATE INDEX "payload_jobs_log_parent_id_idx" ON "payload_jobs_log" USING btree ("_parent_id");
  CREATE INDEX "payload_jobs_completed_at_idx" ON "payload_jobs" USING btree ("completed_at");
  CREATE INDEX "payload_jobs_total_tried_idx" ON "payload_jobs" USING btree ("total_tried");
  CREATE INDEX "payload_jobs_has_error_idx" ON "payload_jobs" USING btree ("has_error");
  CREATE INDEX "payload_jobs_task_slug_idx" ON "payload_jobs" USING btree ("task_slug");
  CREATE INDEX "payload_jobs_queue_idx" ON "payload_jobs" USING btree ("queue");
  CREATE INDEX "payload_jobs_wait_until_idx" ON "payload_jobs" USING btree ("wait_until");
  CREATE INDEX "payload_jobs_processing_idx" ON "payload_jobs" USING btree ("processing");
  CREATE INDEX "payload_jobs_updated_at_idx" ON "payload_jobs" USING btree ("updated_at");
  CREATE INDEX "payload_jobs_created_at_idx" ON "payload_jobs" USING btree ("created_at");
  CREATE INDEX "payload_locked_documents_global_slug_idx" ON "payload_locked_documents" USING btree ("global_slug");
  CREATE INDEX "payload_locked_documents_updated_at_idx" ON "payload_locked_documents" USING btree ("updated_at");
  CREATE INDEX "payload_locked_documents_created_at_idx" ON "payload_locked_documents" USING btree ("created_at");
  CREATE INDEX "payload_locked_documents_rels_order_idx" ON "payload_locked_documents_rels" USING btree ("order");
  CREATE INDEX "payload_locked_documents_rels_parent_idx" ON "payload_locked_documents_rels" USING btree ("parent_id");
  CREATE INDEX "payload_locked_documents_rels_path_idx" ON "payload_locked_documents_rels" USING btree ("path");
  CREATE INDEX "payload_locked_documents_rels_events_id_idx" ON "payload_locked_documents_rels" USING btree ("events_id");
  CREATE INDEX "payload_locked_documents_rels_articles_id_idx" ON "payload_locked_documents_rels" USING btree ("articles_id");
  CREATE INDEX "payload_locked_documents_rels_news_id_idx" ON "payload_locked_documents_rels" USING btree ("news_id");
  CREATE INDEX "payload_locked_documents_rels_publications_id_idx" ON "payload_locked_documents_rels" USING btree ("publications_id");
  CREATE INDEX "payload_locked_documents_rels_social_posts_id_idx" ON "payload_locked_documents_rels" USING btree ("social_posts_id");
  CREATE INDEX "payload_locked_documents_rels_media_id_idx" ON "payload_locked_documents_rels" USING btree ("media_id");
  CREATE INDEX "payload_locked_documents_rels_sources_id_idx" ON "payload_locked_documents_rels" USING btree ("sources_id");
  CREATE INDEX "payload_locked_documents_rels_ingestion_runs_id_idx" ON "payload_locked_documents_rels" USING btree ("ingestion_runs_id");
  CREATE INDEX "payload_locked_documents_rels_pending_updates_id_idx" ON "payload_locked_documents_rels" USING btree ("pending_updates_id");
  CREATE INDEX "payload_locked_documents_rels_ingestion_records_id_idx" ON "payload_locked_documents_rels" USING btree ("ingestion_records_id");
  CREATE INDEX "payload_locked_documents_rels_users_id_idx" ON "payload_locked_documents_rels" USING btree ("users_id");
  CREATE INDEX "payload_locked_documents_rels_ingestion_clients_id_idx" ON "payload_locked_documents_rels" USING btree ("ingestion_clients_id");
  CREATE INDEX "payload_preferences_key_idx" ON "payload_preferences" USING btree ("key");
  CREATE INDEX "payload_preferences_updated_at_idx" ON "payload_preferences" USING btree ("updated_at");
  CREATE INDEX "payload_preferences_created_at_idx" ON "payload_preferences" USING btree ("created_at");
  CREATE INDEX "payload_preferences_rels_order_idx" ON "payload_preferences_rels" USING btree ("order");
  CREATE INDEX "payload_preferences_rels_parent_idx" ON "payload_preferences_rels" USING btree ("parent_id");
  CREATE INDEX "payload_preferences_rels_path_idx" ON "payload_preferences_rels" USING btree ("path");
  CREATE INDEX "payload_preferences_rels_users_id_idx" ON "payload_preferences_rels" USING btree ("users_id");
  CREATE INDEX "payload_migrations_updated_at_idx" ON "payload_migrations" USING btree ("updated_at");
  CREATE INDEX "payload_migrations_created_at_idx" ON "payload_migrations" USING btree ("created_at");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "events_source_references" CASCADE;
  DROP TABLE "events" CASCADE;
  DROP TABLE "events_texts" CASCADE;
  DROP TABLE "_events_v_version_source_references" CASCADE;
  DROP TABLE "_events_v" CASCADE;
  DROP TABLE "_events_v_texts" CASCADE;
  DROP TABLE "articles_source_references" CASCADE;
  DROP TABLE "articles" CASCADE;
  DROP TABLE "articles_texts" CASCADE;
  DROP TABLE "_articles_v_version_source_references" CASCADE;
  DROP TABLE "_articles_v" CASCADE;
  DROP TABLE "_articles_v_texts" CASCADE;
  DROP TABLE "news_source_references" CASCADE;
  DROP TABLE "news" CASCADE;
  DROP TABLE "news_texts" CASCADE;
  DROP TABLE "_news_v_version_source_references" CASCADE;
  DROP TABLE "_news_v" CASCADE;
  DROP TABLE "_news_v_texts" CASCADE;
  DROP TABLE "publications_source_references" CASCADE;
  DROP TABLE "publications" CASCADE;
  DROP TABLE "publications_texts" CASCADE;
  DROP TABLE "_publications_v_version_source_references" CASCADE;
  DROP TABLE "_publications_v" CASCADE;
  DROP TABLE "_publications_v_texts" CASCADE;
  DROP TABLE "social_posts_source_references" CASCADE;
  DROP TABLE "social_posts" CASCADE;
  DROP TABLE "social_posts_texts" CASCADE;
  DROP TABLE "social_posts_rels" CASCADE;
  DROP TABLE "_social_posts_v_version_source_references" CASCADE;
  DROP TABLE "_social_posts_v" CASCADE;
  DROP TABLE "_social_posts_v_texts" CASCADE;
  DROP TABLE "_social_posts_v_rels" CASCADE;
  DROP TABLE "media" CASCADE;
  DROP TABLE "sources" CASCADE;
  DROP TABLE "ingestion_runs" CASCADE;
  DROP TABLE "pending_updates_changes" CASCADE;
  DROP TABLE "pending_updates" CASCADE;
  DROP TABLE "ingestion_records" CASCADE;
  DROP TABLE "users_sessions" CASCADE;
  DROP TABLE "users" CASCADE;
  DROP TABLE "ingestion_clients_scopes" CASCADE;
  DROP TABLE "ingestion_clients" CASCADE;
  DROP TABLE "payload_kv" CASCADE;
  DROP TABLE "payload_jobs_log" CASCADE;
  DROP TABLE "payload_jobs" CASCADE;
  DROP TABLE "payload_locked_documents" CASCADE;
  DROP TABLE "payload_locked_documents_rels" CASCADE;
  DROP TABLE "payload_preferences" CASCADE;
  DROP TABLE "payload_preferences_rels" CASCADE;
  DROP TABLE "payload_migrations" CASCADE;
  DROP TABLE "settings" CASCADE;
  DROP TYPE "public"."enum_events_free_food";
  DROP TYPE "public"."enum_events_event_status";
  DROP TYPE "public"."enum_events_review_status";
  DROP TYPE "public"."enum_events_status";
  DROP TYPE "public"."enum__events_v_version_free_food";
  DROP TYPE "public"."enum__events_v_version_event_status";
  DROP TYPE "public"."enum__events_v_version_review_status";
  DROP TYPE "public"."enum__events_v_version_status";
  DROP TYPE "public"."enum_articles_review_status";
  DROP TYPE "public"."enum_articles_status";
  DROP TYPE "public"."enum__articles_v_version_review_status";
  DROP TYPE "public"."enum__articles_v_version_status";
  DROP TYPE "public"."enum_news_review_status";
  DROP TYPE "public"."enum_news_status";
  DROP TYPE "public"."enum__news_v_version_review_status";
  DROP TYPE "public"."enum__news_v_version_status";
  DROP TYPE "public"."enum_publications_review_status";
  DROP TYPE "public"."enum_publications_status";
  DROP TYPE "public"."enum__publications_v_version_review_status";
  DROP TYPE "public"."enum__publications_v_version_status";
  DROP TYPE "public"."enum_social_posts_platform";
  DROP TYPE "public"."enum_social_posts_post_type";
  DROP TYPE "public"."enum_social_posts_publishing_status";
  DROP TYPE "public"."enum_social_posts_review_status";
  DROP TYPE "public"."enum_social_posts_status";
  DROP TYPE "public"."enum__social_posts_v_version_platform";
  DROP TYPE "public"."enum__social_posts_v_version_post_type";
  DROP TYPE "public"."enum__social_posts_v_version_publishing_status";
  DROP TYPE "public"."enum__social_posts_v_version_review_status";
  DROP TYPE "public"."enum__social_posts_v_version_status";
  DROP TYPE "public"."enum_media_usage_rights";
  DROP TYPE "public"."enum_media_visibility";
  DROP TYPE "public"."enum_sources_source_type";
  DROP TYPE "public"."enum_sources_usage_rights";
  DROP TYPE "public"."enum_ingestion_runs_target_collection";
  DROP TYPE "public"."enum_ingestion_runs_status";
  DROP TYPE "public"."enum_pending_updates_target_collection";
  DROP TYPE "public"."enum_pending_updates_status";
  DROP TYPE "public"."enum_pending_updates_severity";
  DROP TYPE "public"."enum_ingestion_records_target_collection";
  DROP TYPE "public"."enum_users_role";
  DROP TYPE "public"."enum_ingestion_clients_scopes";
  DROP TYPE "public"."enum_payload_jobs_log_task_slug";
  DROP TYPE "public"."enum_payload_jobs_log_state";
  DROP TYPE "public"."enum_payload_jobs_task_slug";`)
}
