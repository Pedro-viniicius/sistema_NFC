CREATE TABLE "administradores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"senha_hash" text NOT NULL,
	"tentativas_falhas" integer DEFAULT 0 NOT NULL,
	"bloqueado_ate" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "administradores_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "cartoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"codigo" text NOT NULL,
	"tipo" text,
	"destino_url" text,
	"status" text DEFAULT 'NAO_CONFIGURADO' NOT NULL,
	"descricao" text,
	"lote_id" uuid,
	"total_acessos" integer DEFAULT 0 NOT NULL,
	"ultimo_acesso_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"ativado_em" timestamp with time zone,
	CONSTRAINT "cartoes_codigo_unique" UNIQUE("codigo"),
	CONSTRAINT "cartoes_codigo_formato" CHECK ("cartoes"."codigo" ~ '^[2-9A-HJKMNP-Z]{6}$'),
	CONSTRAINT "cartoes_status_valido" CHECK ("cartoes"."status" in ('NAO_CONFIGURADO', 'ATIVO', 'INATIVO')),
	CONSTRAINT "cartoes_tipo_valido" CHECK ("cartoes"."tipo" is null or "cartoes"."tipo" in ('INSTAGRAM', 'GOOGLE', 'GENERICO')),
	CONSTRAINT "cartoes_ativo_tem_destino" CHECK ("cartoes"."status" <> 'ATIVO' or ("cartoes"."destino_url" is not null and "cartoes"."tipo" is not null)),
	CONSTRAINT "cartoes_nao_configurado_sem_destino" CHECK ("cartoes"."status" <> 'NAO_CONFIGURADO' or "cartoes"."destino_url" is null)
);
--> statement-breakpoint
CREATE TABLE "lotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identificador" text NOT NULL,
	"ano" integer NOT NULL,
	"sequencia" integer NOT NULL,
	"quantidade" integer NOT NULL,
	"tipo" text,
	"descricao" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lotes_identificador_unique" UNIQUE("identificador"),
	CONSTRAINT "lotes_ano_sequencia_unico" UNIQUE("ano","sequencia"),
	CONSTRAINT "lotes_quantidade_positiva" CHECK ("lotes"."quantidade" > 0),
	CONSTRAINT "lotes_tipo_valido" CHECK ("lotes"."tipo" is null or "lotes"."tipo" in ('INSTAGRAM', 'GOOGLE', 'GENERICO'))
);
--> statement-breakpoint
ALTER TABLE "cartoes" ADD CONSTRAINT "cartoes_lote_id_lotes_id_fk" FOREIGN KEY ("lote_id") REFERENCES "public"."lotes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cartoes_status_idx" ON "cartoes" USING btree ("status");--> statement-breakpoint
CREATE INDEX "cartoes_lote_idx" ON "cartoes" USING btree ("lote_id");--> statement-breakpoint
CREATE INDEX "cartoes_criado_em_idx" ON "cartoes" USING btree ("criado_em");