interface StatusMessageProps {
  readonly message: string;
  readonly title: string;
}

export function StatusMessage({ message, title }: StatusMessageProps) {
  return (
    <section className="powerwiki-panel" role="status">
      <h2>{title}</h2>
      <p>{message}</p>
    </section>
  );
}

