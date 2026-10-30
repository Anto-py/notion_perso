CREATE TABLE "icon_images" (
	"id" text PRIMARY KEY NOT NULL,
	"media_id" text NOT NULL,
	"name" text NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "icon_images_media_id_unique" UNIQUE("media_id")
);
--> statement-breakpoint
ALTER TABLE "icon_images" ADD CONSTRAINT "icon_images_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;