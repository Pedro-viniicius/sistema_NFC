CREATE TABLE "artes_de_impressao" (
	"tipo" text PRIMARY KEY NOT NULL,
	"pdf" "bytea" NOT NULL,
	"nome_do_arquivo" text NOT NULL,
	"tamanho_bytes" integer NOT NULL,
	"qr_x_mm" double precision NOT NULL,
	"qr_y_mm" double precision NOT NULL,
	"qr_tamanho_mm" double precision NOT NULL,
	"cor_do_codigo" text,
	"enviado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artes_tipo_com_modelo" CHECK ("artes_de_impressao"."tipo" in ('GOOGLE', 'INSTAGRAM')),
	CONSTRAINT "artes_cor_do_codigo_valida" CHECK ("artes_de_impressao"."cor_do_codigo" is null or "artes_de_impressao"."cor_do_codigo" in ('preto', 'branco')),
	CONSTRAINT "artes_qr_tamanho_positivo" CHECK ("artes_de_impressao"."qr_tamanho_mm" > 0)
);
