-- Defesa em profundidade para o invariante central do produto:
-- o código público de um cartão já fabricado NUNCA pode ser alterado,
-- porque ele está impresso no QR Code e gravado no chip NFC.
CREATE FUNCTION impedir_alteracao_do_codigo() RETURNS trigger AS $$
BEGIN
  IF NEW.codigo IS DISTINCT FROM OLD.codigo THEN
    RAISE EXCEPTION 'O codigo do cartao e permanente e nao pode ser alterado (% -> %)', OLD.codigo, NEW.codigo
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER cartoes_codigo_imutavel
  BEFORE UPDATE ON cartoes
  FOR EACH ROW
  EXECUTE FUNCTION impedir_alteracao_do_codigo();
