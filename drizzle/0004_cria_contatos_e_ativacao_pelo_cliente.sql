CREATE TABLE "contatos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cartao_id" uuid,
	"cartao_codigo" text NOT NULL,
	"lote_identificador" text,
	"tipo" text NOT NULL,
	"loja" text NOT NULL,
	"ramo" text,
	"nome" text NOT NULL,
	"papel" text NOT NULL,
	"decisor" text,
	"whatsapp" text NOT NULL,
	"aceitou_ofertas" boolean NOT NULL,
	"versao_do_texto" text NOT NULL,
	"registrado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"situacao" text DEFAULT 'NOVO' NOT NULL,
	"observacao" text,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contatos_cartao_id_unique" UNIQUE("cartao_id"),
	CONSTRAINT "contatos_whatsapp_formato" CHECK ("contatos"."whatsapp" ~ '^\+55[1-9][0-9]{9,10}$'),
	CONSTRAINT "contatos_situacao_valida" CHECK ("contatos"."situacao" in ('NOVO', 'CONVERSANDO', 'CLIENTE', 'SEM_INTERESSE')),
	CONSTRAINT "contatos_papel_valido" CHECK ("contatos"."papel" in ('DONO', 'GERENTE', 'FUNCIONARIO', 'OUTRO')),
	CONSTRAINT "contatos_ramo_valido" CHECK ("contatos"."ramo" is null or "contatos"."ramo" in ('RESTAURANTE', 'BELEZA', 'VAREJO', 'SAUDE', 'SERVICOS', 'OUTRO')),
	CONSTRAINT "contatos_tipo_valido" CHECK ("contatos"."tipo" in ('INSTAGRAM', 'GOOGLE', 'GENERICO'))
);
--> statement-breakpoint
CREATE TABLE "limites_de_tentativas" (
	"chave" text PRIMARY KEY NOT NULL,
	"contagem" integer NOT NULL,
	"inicio" timestamp with time zone NOT NULL,
	"expira_em" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lotes" ADD COLUMN "ativacao_pelo_cliente" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "contatos" ADD CONSTRAINT "contatos_cartao_id_cartoes_id_fk" FOREIGN KEY ("cartao_id") REFERENCES "public"."cartoes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contatos_whatsapp_idx" ON "contatos" USING btree ("whatsapp");--> statement-breakpoint
CREATE INDEX "contatos_situacao_idx" ON "contatos" USING btree ("situacao");--> statement-breakpoint
CREATE INDEX "contatos_registrado_em_idx" ON "contatos" USING btree ("registrado_em");--> statement-breakpoint
CREATE INDEX "limites_expira_em_idx" ON "limites_de_tentativas" USING btree ("expira_em");