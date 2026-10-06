CREATE TABLE "templates_de_impressao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"tipo" text,
	"status" text DEFAULT 'RASCUNHO' NOT NULL,
	"padrao" boolean DEFAULT false NOT NULL,
	"chave_do_arquivo" text NOT NULL,
	"arquivo_nome_original" text NOT NULL,
	"mime_type" text DEFAULT 'application/pdf' NOT NULL,
	"tamanho_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"numero_de_paginas" integer NOT NULL,
	"rotacao" integer NOT NULL,
	"media_box" jsonb NOT NULL,
	"crop_box" jsonb NOT NULL,
	"trim_box" jsonb,
	"bleed_box" jsonb,
	"largura_da_pagina_mm" double precision NOT NULL,
	"altura_da_pagina_mm" double precision NOT NULL,
	"qr_x_pt" double precision,
	"qr_y_pt" double precision,
	"qr_largura_pt" double precision,
	"qr_altura_pt" double precision,
	"qr_zona_de_silencio_modulos" integer DEFAULT 4 NOT NULL,
	"qr_configurado_em" timestamp with time zone,
	"qr_testado_em" timestamp with time zone,
	"bloqueado_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "templates_de_impressao_chave_do_arquivo_unique" UNIQUE("chave_do_arquivo"),
	CONSTRAINT "templates_status_valido" CHECK ("templates_de_impressao"."status" in ('RASCUNHO', 'PRONTO', 'INATIVO')),
	CONSTRAINT "templates_tipo_valido" CHECK ("templates_de_impressao"."tipo" is null or "templates_de_impressao"."tipo" in ('INSTAGRAM', 'GOOGLE', 'GENERICO')),
	CONSTRAINT "templates_uma_pagina_sem_rotacao" CHECK ("templates_de_impressao"."numero_de_paginas" = 1 and "templates_de_impressao"."rotacao" = 0),
	CONSTRAINT "templates_zona_de_silencio_minima" CHECK ("templates_de_impressao"."qr_zona_de_silencio_modulos" >= 2),
	CONSTRAINT "templates_area_do_qr_completa" CHECK (("templates_de_impressao"."qr_x_pt" is null and "templates_de_impressao"."qr_y_pt" is null and "templates_de_impressao"."qr_largura_pt" is null and "templates_de_impressao"."qr_altura_pt" is null)
        or ("templates_de_impressao"."qr_x_pt" is not null and "templates_de_impressao"."qr_y_pt" is not null and "templates_de_impressao"."qr_largura_pt" > 0 and "templates_de_impressao"."qr_altura_pt" > 0)),
	CONSTRAINT "templates_pronto_exige_qr_testado" CHECK ("templates_de_impressao"."status" <> 'PRONTO' or (
        "templates_de_impressao"."tipo" is not null and "templates_de_impressao"."qr_x_pt" is not null
        and "templates_de_impressao"."qr_testado_em" is not null and "templates_de_impressao"."qr_configurado_em" is not null
        and "templates_de_impressao"."qr_testado_em" >= "templates_de_impressao"."qr_configurado_em"
      )),
	CONSTRAINT "templates_padrao_exige_pronto" CHECK (not "templates_de_impressao"."padrao" or "templates_de_impressao"."status" = 'PRONTO')
);
--> statement-breakpoint
ALTER TABLE "lotes" ADD COLUMN "template_id" uuid;--> statement-breakpoint
ALTER TABLE "lotes" ADD COLUMN "template_sha256" text;--> statement-breakpoint
CREATE UNIQUE INDEX "templates_um_padrao_por_tipo" ON "templates_de_impressao" USING btree ("tipo") WHERE "templates_de_impressao"."padrao";--> statement-breakpoint
CREATE INDEX "templates_tipo_status_idx" ON "templates_de_impressao" USING btree ("tipo","status");--> statement-breakpoint
ALTER TABLE "lotes" ADD CONSTRAINT "lotes_template_id_templates_de_impressao_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates_de_impressao"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lotes_template_idx" ON "lotes" USING btree ("template_id");--> statement-breakpoint
ALTER TABLE "lotes" ADD CONSTRAINT "lotes_template_com_sha256" CHECK (("lotes"."template_id" is null) = ("lotes"."template_sha256" is null));